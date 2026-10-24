//! Harbour works of a port town, by construction: the town stands on its
//! water (`sited`), its waterfront is a continuous stone quay between the
//! water and the first row of lots (`quays`), and piers, landing stages or
//! moles project from the quays into the water (`works`). Lengths, widths and
//! spacings scale with the port's population and come from the culture's
//! `plan.harbour` entry in the catalogue (defaults below).
use super::super::{LayoutConfig, Point, Shape, Site, Street, Surface, geometry as g, routing};

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn add(p: Point, n: Point, d: f64) -> Point {
    Point {
        x: p.x + n.x * d,
        y: p.y + n.y * d,
    }
}
fn unit(a: Point, b: Point) -> Point {
    let l = dist(a, b).max(1e-9);
    Point {
        x: (b.x - a.x) / l,
        y: (b.y - a.y) / l,
    }
}
fn left(t: Point) -> Point {
    Point { x: -t.y, y: t.x }
}
fn length(path: &[Point]) -> f64 {
    path.windows(2).map(|w| dist(w[0], w[1])).sum()
}

/// Harbour parameters of a culture (`cultures.<c>.plan.harbour`).
#[derive(Clone, Copy, Debug)]
pub(in super::super) struct Harbour {
    /// Quay length per square root of inhabitants (m): 20 000 people and
    /// 6 m/√hab give ~850 m of quays.
    pub quay_per_sqrt_pop: f64,
    pub quay_width: f64,
    /// Distance between piers along a quay, for a 10 000-inhabitant port.
    pub pier_spacing: f64,
    /// Pier length range (m) over open water; rivers and canals get landing
    /// stages instead, short enough to keep the channel free.
    pub pier_length: (f64, f64),
    /// Sea ports build a sheltered basin between two moles where the coast
    /// allows.
    pub basin: bool,
    /// Lagoon towns line every shore and canal with quays (fondamenta).
    pub fondamenta: bool,
}
impl Default for Harbour {
    fn default() -> Self {
        Self {
            quay_per_sqrt_pop: 6.0,
            quay_width: 6.0,
            pier_spacing: 110.0,
            pier_length: (18.0, 45.0),
            basin: false,
            fondamenta: false,
        }
    }
}
pub(in super::super) fn params(culture: &str) -> Harbour {
    let h = &super::super::catalogue()["cultures"][culture]["plan"]["harbour"];
    let d = Harbour::default();
    let num = |k: &str, v: f64| {
        h[k].as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .unwrap_or(v)
    };
    let range = &h["pierLength"];
    let (a, b) = (
        range[0].as_f64().unwrap_or(d.pier_length.0),
        range[1].as_f64().unwrap_or(d.pier_length.1),
    );
    Harbour {
        quay_per_sqrt_pop: num("quayPerSqrtPop", d.quay_per_sqrt_pop),
        quay_width: num("quayWidth", d.quay_width).clamp(3.0, 12.0),
        pier_spacing: num("pierSpacing", d.pier_spacing).clamp(30.0, 400.0),
        pier_length: (a.clamp(4.0, 200.0), b.clamp(a.clamp(4.0, 200.0), 250.0)),
        basin: h["basin"].as_bool().unwrap_or(d.basin),
        fondamenta: h["fondamenta"].as_bool().unwrap_or(d.fondamenta),
    }
}

/// A port: its role, its archetype, declared navigable access or a port
/// function. Waterfront cultures (`plan.waterfront`) build quays as well.
pub(in super::super) fn port_town(cfg: &LayoutConfig) -> bool {
    cfg.programme.role == "port"
        || matches!(cfg.site_archetype.as_str(), "harbor" | "lakeshore")
        || cfg.programme.navigable_access
        || cfg
            .programme
            .functions
            .as_ref()
            .is_some_and(|f| f.port > 0.0)
}

fn code(surface: Surface<'_>, p: Point) -> u8 {
    if p.x < 0.0 || p.y < 0.0 || p.x >= surface.width || p.y >= surface.width {
        return 1;
    }
    let x = (p.x / surface.width * surface.n as f64) as usize;
    let y = (p.y / surface.width * surface.n as f64) as usize;
    let c = surface.water[y.min(surface.n - 1) * surface.n + x.min(surface.n - 1)];
    if c == 0 && surface.wet(p) { 1 } else { c }
}

/// Distance from the town centre to its harbour front: the core reaches the
/// water, with land behind it.
fn front_distance(radius: f64) -> f64 {
    (0.25 * radius).clamp(60.0, 250.0)
}

/// A port town placed inland moves to the nearest gentle shore of its sea or
/// lake (a river only when no sea or lake is in reach), its centre at
/// `front_distance` from the water on the line from its original centre.
/// Cliff shores (the 60 m strip behind the bank climbing faster than a street
/// grade) are never chosen. `None` when the town already fronts its water or none is in
/// reach (2.5 radii, at least 1 km).
pub(in super::super) fn sited(
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
) -> Option<Site> {
    if !port_town(cfg) || surface.n < 2 || surface.wet(site.center) {
        return None;
    }
    let n = surface.n as i64;
    let cell = surface.width / surface.n as f64;
    let reach = front_distance(site.radius);
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let grade = if super::super::profiles::stairs_allowed(cfg, culture) {
        cfg.max_stair_grade
    } else {
        cfg.max_street_grade
    };
    let search = (2.5 * site.radius).max(1000.0);
    let at = |p: Point| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
    let centre = |i: i64, j: i64| Point {
        x: (i as f64 + 0.5) * cell,
        y: (j as f64 + 0.5) * cell,
    };
    let raw = |i: i64, j: i64| surface.water[(j * n + i) as usize];
    let (ci, cj) = at(site.center);
    let r = (search / cell).ceil() as i64;
    // Nearest bank cell per water kind (sea or lake, then river).
    // Gentle bank cells per water kind (sea or lake, then river).
    let mut banks: [Vec<(f64, Point, Point)>; 2] = [vec![], vec![]];
    for j in (cj - r).max(1)..=(cj + r).min(n - 2) {
        for i in (ci - r).max(1)..=(ci + r).min(n - 2) {
            let w = raw(i, j);
            if w == 0 {
                continue;
            }
            let q = centre(i, j);
            let d = dist(q, site.center);
            let kind = usize::from(w == 3);
            if d > search {
                continue;
            }
            // A bank: a dry 4-neighbour, land gentle behind it.
            let Some((di, dj)) = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                .into_iter()
                .find(|&(di, dj)| raw(i + di, j + dj) == 0)
            else {
                continue;
            };
            let bank = centre(i + di, j + dj);
            let inland = unit(q, bank);
            // Open water beyond the bank: a basin (40 m), or a river.
            let open = if w == 3 { 3.0 } else { 40.0 };
            if !surface.wet(add(q, inland, -open)) || !surface.wet(add(q, inland, -open * 0.5)) {
                continue;
            }
            // The harbour strip (quay, landing rows: 60 m behind the bank)
            // climbs at most a street grade over every 12 m.
            let gentle = (0..5).all(|k| {
                let (a, b) = (
                    add(bank, inland, 12.0 * k as f64),
                    add(bank, inland, 12.0 * (k + 1) as f64),
                );
                !surface.wet(b)
                    && (surface.height_at(b) - surface.height_at(a)).abs()
                        <= 12.0 * cfg.max_street_grade
            });
            if !gentle {
                continue;
            }
            banks[kind].push((d, q, bank));
        }
    }
    // A harbour front is a gentle shore of some length, not a single gentle
    // cell on a cliff coast: about 80 m of gentle bank within 150 m.
    const BIN: f64 = 100.0;
    for list in banks.iter_mut() {
        let mut count: std::collections::HashMap<(i64, i64), usize> = Default::default();
        let key = |p: Point| ((p.x / BIN).floor() as i64, (p.y / BIN).floor() as i64);
        for b in list.iter() {
            *count.entry(key(b.1)).or_default() += 1;
        }
        let front = (80.0 / cell).ceil() as usize;
        list.retain(|b| {
            let (x, y) = key(b.1);
            let around: usize = (-1..=1)
                .flat_map(|dx| (-1..=1).map(move |dy| (x + dx, y + dy)))
                .map(|k| count.get(&k).copied().unwrap_or(0))
                .sum();
            around >= front
        });
    }
    let kind = usize::from(banks[0].is_empty());
    let mut banks = std::mem::take(&mut banks[kind]);
    banks.sort_by(|a, b| a.0.total_cmp(&b.0));
    if banks.first().is_none_or(|b| b.0 <= reach) {
        return None;
    }
    // The nearest bank whose town ground is buildable: on the line from the
    // water to the old centre, the first dry point between one and two front
    // distances whose 30 m surroundings stay within a lane grade.
    let level = |c: Point| {
        let h = surface.height_at(c);
        (0..8).all(|k| {
            let a = k as f64 * std::f64::consts::FRAC_PI_4;
            let q = add(
                c,
                Point {
                    x: a.cos(),
                    y: a.sin(),
                },
                30.0,
            );
            !surface.wet(q) && (surface.height_at(q) - h).abs() <= 30.0 * cfg.max_lane_grade
        })
    };
    // The nearest banks that work (at most six, 300 m apart), then the one
    // with the most buildable land around its centre.
    let mut tried: Vec<Point> = vec![];
    let mut found: Vec<(usize, Point, Point)> = vec![];
    for (d, water, bank) in banks {
        if tried.len() >= 96 || found.len() >= 6 {
            break;
        }
        if tried.iter().any(|&t| dist(t, water) < 60.0)
            || found.iter().any(|f| dist(f.2, water) < 300.0)
        {
            continue;
        }
        tried.push(water);
        let toward = unit(water, site.center);
        let start = dist(water, bank).max(reach);
        let center = (0..)
            .map(|k| start + 5.0 * k as f64)
            .take_while(|&t| t < d.min(start + reach))
            .map(|t| add(water, toward, t))
            .find(|&p| !surface.wet(p) && level(p));
        // The town grows down to its harbour: land joined to the centre by
        // street-grade moves (the footprint's own growth rule) reaches the
        // bank.
        let Some(center) = center.filter(|&c| {
            let middle = super::point(c, bank, 0.5);
            flood(
                surface,
                c,
                middle,
                dist(c, bank) * 0.5 + 60.0,
                12.0,
                grade,
                Some(bank),
            )
            .0
        }) else {
            continue;
        };
        let land = flood(
            surface,
            center,
            center,
            0.8 * site.radius,
            16.0,
            grade,
            None,
        )
        .1;
        found.push((land, center, water));
    }
    let (_, center, _) = found.into_iter().max_by_key(|f| f.0)?;
    Some(Site {
        center,
        ..site.clone()
    })
}

/// Harbour apron: the land between a town domain and its water, within
/// `reach`, joined to the domain along its shore-facing edges, so quays stand
/// at the waterline. The footprint's growth grid stops a cell or two short of
/// a shore; the apron closes that gap where a street could reach the water
/// (never down a cliff). Returns the domain unchanged when nothing is added.
pub(in super::super) fn apron(
    domain: &Shape,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    reach: f64,
) -> Shape {
    const STEP: f64 = 4.0;
    let mut quads: Vec<Shape> = vec![];
    for (ring, outer) in
        std::iter::once((&domain.outer, true)).chain(domain.holes.iter().map(|h| (h, false)))
    {
        if ring.len() < 3 {
            continue;
        }
        let interior_left = (g::signed(ring) > 0.0) == outer;
        // (point, outward normal, distance to open water) every 4 m.
        let mut marks: Vec<Option<(Point, Point, f64)>> = vec![];
        for k in 0..ring.len() {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            let l = dist(a, b);
            if l < 1e-9 {
                continue;
            }
            let t = unit(a, b);
            let out = if interior_left {
                Point { x: t.y, y: -t.x }
            } else {
                left(t)
            };
            let m = (l / STEP).ceil().max(1.0) as usize;
            for j in 0..m {
                let p = add(a, t, l * j as f64 / m as f64);
                let hit = (1..=(reach / 2.0) as usize)
                    .map(|i| 2.0 * i as f64)
                    .find(|&d| {
                        let q = add(p, out, d);
                        q.x >= 0.0
                            && q.y >= 0.0
                            && q.x < surface.width
                            && q.y < surface.width
                            && surface.wet(q)
                    });
                marks.push(
                    hit.filter(|&d| {
                        d > 3.0
                            && routing::segment_clear(
                                surface,
                                p,
                                add(p, out, d - 2.5),
                                cfg.max_street_grade,
                            )
                            && surface.wet(add(p, out, d + 3.5))
                    })
                    .map(|d| (p, out, d)),
                );
            }
        }
        for k in 0..marks.len() {
            if let (Some(a), Some(b)) = (marks[k], marks[(k + 1) % marks.len()]) {
                quads.push(g::normalized(Shape {
                    outer: vec![a.0, b.0, add(b.0, b.1, b.2 + 2.0), add(a.0, a.1, a.2 + 2.0)],
                    holes: vec![],
                }));
            }
        }
    }
    if quads.is_empty() {
        return domain.clone();
    }
    quads.push(domain.clone());

    let inside = g::interior_point(domain);
    // Pockets the quads close against a stair-stepped edge are land of the
    // apron, not holes; water holes come back with the dry clip.
    g::union(&quads)
        .into_iter()
        .map(|mut s| {
            s.holes.retain(|h| g::signed(h).abs() >= 2500.0);
            s
        })
        .flat_map(|s| g::dry_clip(&surface, &s))
        .filter(|s| g::contains(s, inside))
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
        // A strip of a few square metres is no apron: the domain stays as
        // grown.
        .filter(|s| g::area(s) >= g::area(domain) + 200.0)
        .unwrap_or_else(|| domain.clone())
}

/// Flood of `step` moves at most `grade` (8-neighbour) from `from`, within
/// `half` of `middle`: whether it comes within 15 m of `to`, and how many
/// cells it covers.
fn flood(
    surface: Surface<'_>,
    from: Point,
    middle: Point,
    half: f64,
    step: f64,
    grade: f64,
    to: Option<Point>,
) -> (bool, usize) {
    let side = ((2.0 * half / step).ceil() as usize).max(2);
    let origin = Point {
        x: middle.x - half,
        y: middle.y - half,
    };
    let at = |i: usize| Point {
        x: origin.x + (i % side) as f64 * step,
        y: origin.y + (i / side) as f64 * step,
    };
    let (x, y) = (
        ((from.x - origin.x) / step).round(),
        ((from.y - origin.y) / step).round(),
    );
    if x < 0.0 || y < 0.0 || x as usize >= side || y as usize >= side {
        return (false, 0);
    }
    let start = y as usize * side + x as usize;
    let mut seen = vec![false; side * side];
    let mut queue = std::collections::VecDeque::from([start]);
    seen[start] = true;
    let mut count = 0;
    while let Some(i) = queue.pop_front() {
        // The first move starts from the point itself.
        let p = if i == start { from } else { at(i) };
        count += 1;
        if let Some(t) = to
            && (dist(p, t) <= 15.0
                || dist(p, t) <= step * 1.5 && routing::segment_clear(surface, p, t, grade))
        {
            return (true, count);
        }
        let (x, y) = ((i % side) as i64, (i / side) as i64);
        for (dx, dy) in [
            (1, 0),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= side as i64 || ny >= side as i64 {
                continue;
            }
            let j = ny as usize * side + nx as usize;
            if !seen[j]
                && dist(at(j), middle) <= half
                && routing::segment_clear(surface, p, at(j), grade)
            {
                seen[j] = true;
                queue.push_back(j);
            }
        }
    }
    (false, count)
}

struct Piece {
    path: Vec<Point>,
    near: f64,
    river: bool,
}

/// Street segments binned on a 25 m grid, for distance queries.
struct Index {
    map: std::collections::HashMap<(i64, i64), Vec<(Point, Point, f64)>>,
}
impl Index {
    const CELL: f64 = 25.0;
    fn key(p: Point) -> (i64, i64) {
        (
            (p.x / Self::CELL).floor() as i64,
            (p.y / Self::CELL).floor() as i64,
        )
    }
    fn new(streets: &[Street]) -> Self {
        let mut map: std::collections::HashMap<(i64, i64), Vec<(Point, Point, f64)>> =
            Default::default();
        for s in streets {
            for (i, w) in s.path.windows(2).enumerate() {
                let half = s.widths.get(i).copied().unwrap_or(4.0) * 0.5;
                let (a, b) = (Self::key(w[0]), Self::key(w[1]));
                for x in a.0.min(b.0)..=a.0.max(b.0) {
                    for y in a.1.min(b.1)..=a.1.max(b.1) {
                        map.entry((x, y)).or_default().push((w[0], w[1], half));
                    }
                }
            }
        }
        Self { map }
    }
    /// Whether a street running along `t` (within 35°) has its ribbon
    /// within `gap` of `p`. Streets crossing the shore do not count.
    fn along(&self, p: Point, t: Point, gap: f64) -> bool {
        let (x, y) = Self::key(p);
        (-1..=1).any(|dx| {
            (-1..=1).any(|dy| {
                self.map.get(&(x + dx, y + dy)).is_some_and(|v| {
                    v.iter().any(|&(a, b, half)| {
                        let u = unit(a, b);
                        (u.x * t.x + u.y * t.y).abs() > 0.82 && g::distance(p, a, b).0 < half + gap
                    })
                })
            })
        })
    }
}

/// Inward-offset shore runs of one ring (dense, a point every 2 m): samples
/// whose outward side is water within `probe`, grouped, smoothed over the
/// raster step and moved inland by `setback`.
fn shore_runs(
    ring: &[Point],
    interior_left: bool,
    surface: Surface<'_>,
    probe: f64,
    setback: f64,
) -> Vec<Vec<Point>> {
    const STEP: f64 = 2.0;
    let mut samples: Vec<(Point, bool)> = vec![];
    for k in 0..ring.len() {
        let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
        let l = dist(a, b);
        if l < 1e-9 {
            continue;
        }
        let t = unit(a, b);
        let out = if interior_left {
            Point { x: t.y, y: -t.x }
        } else {
            left(t)
        };
        let m = (l / STEP).ceil().max(1.0) as usize;
        for s in 0..m {
            let p = add(a, t, l * s as f64 / m as f64);
            let water = |q: Point| {
                q.x >= 0.0
                    && q.y >= 0.0
                    && q.x < surface.width
                    && q.y < surface.width
                    && surface.wet(q)
            };
            // Water at the edge (within `probe`) that is a water body, not a
            // speck: a raster cell across (any river: a sea or lake front
            // takes the quay budget first, see `quays`).
            let wet = [1.5, probe * 0.5, probe].iter().any(|&d| {
                let q = add(p, out, d);
                water(q) && (code(surface, q) == 3 || water(add(p, out, d + 3.5)))
            });
            samples.push((p, wet && !surface.wet(add(p, out, -2.0))));
        }
    }
    let count = samples.len();
    // Start the cyclic walk on a dry sample so a run is never split in two.
    let Some(start) = samples.iter().position(|s| !s.1) else {
        return vec![];
    };
    let mut runs: Vec<Vec<Point>> = vec![];
    let mut current: Vec<Point> = vec![];
    let mut gap = 0;
    for k in 0..=count {
        let (p, wet) = samples[(start + k) % count];
        if wet && k < count {
            current.push(p);
            gap = 0;
        } else {
            gap += 1;
            if gap > 2 || k == count {
                if current.len() >= 6 {
                    runs.push(std::mem::take(&mut current));
                } else {
                    current.clear();
                }
            }
        }
    }
    let cell = surface.width / surface.n as f64;
    let half = ((1.5 * cell / STEP).ceil() as usize).max(2);
    runs.into_iter()
        .map(|run| {
            let smooth: Vec<Point> = (0..run.len())
                .map(|i| {
                    let w = half.min(i).min(run.len() - 1 - i);
                    let s = &run[i - w..=i + w];
                    Point {
                        x: s.iter().map(|p| p.x).sum::<f64>() / s.len() as f64,
                        y: s.iter().map(|p| p.y).sum::<f64>() / s.len() as f64,
                    }
                })
                .collect();
            let offset: Vec<Point> = (0..smooth.len())
                .map(|i| {
                    let a = smooth[i.saturating_sub(half)];
                    let b = smooth[(i + half).min(smooth.len() - 1)];
                    let t = unit(a, b);
                    let inward = if interior_left {
                        left(t)
                    } else {
                        Point { x: t.y, y: -t.x }
                    };
                    add(smooth[i], inward, setback)
                })
                .collect();
            offset
        })
        .collect()
}

/// Continuous quays along the waterfront of `regions`: each shore run, moved
/// inland so the whole platform is dry, split where it leaves its quarter,
/// turns sharply, climbs or stands at a cliff foot. The harbour front nearest
/// the centre is kept first, up to the culture's quay budget for the port's
/// size (every shore for a lagoon town). Each quay joins the town streets
/// by landing streets about every 120 m; a quay that cannot is dropped.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn quays(
    regions: &[Shape],
    streets: &mut Vec<Street>,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    site: &Site,
    culture: &str,
    port: bool,
) {
    const MIN: f64 = 20.0;
    let h = params(culture);
    let cell = surface.width / surface.n as f64;
    let width = if h.fondamenta {
        h.quay_width.min(5.0)
    } else {
        h.quay_width
    };
    let setback = width * 0.5 + 0.6 * cell + 0.5;
    let probe = (cell * 2.0).clamp(6.0, 10.0);
    let grade = cfg.max_street_grade.min(0.05);
    let mut pieces: Vec<Piece> = vec![];
    // Shore already lined by a street (a quay or a street along the water)
    // is served: the quay never doubles it. Long streets are binned once.
    let served = Index::new(streets);
    for region in regions {
        let rings =
            std::iter::once((&region.outer, true)).chain(region.holes.iter().map(|h| (h, false)));
        for (ring, outer) in rings {
            // A pond inside a quarter is no harbour.
            if ring.len() < 3 || !outer && g::signed(ring).abs() < 2500.0 {
                continue;
            }
            let ccw = g::signed(ring) > 0.0;
            let interior_left = ccw == outer;
            for run in shore_runs(ring, interior_left, surface, probe, setback) {
                // Keep the valid stretches of the offset run.
                let mut piece: Vec<Point> = vec![];
                let mut flush = |piece: &mut Vec<Point>| {
                    if piece.len() >= 2 && length(piece) >= MIN {
                        let near = piece
                            .iter()
                            .map(|&p| dist(p, site.center))
                            .fold(f64::INFINITY, f64::min);
                        let path = g::simplify(&std::mem::take(piece), 0.4, |_| false);
                        let river = river_side(surface, &path);
                        pieces.push(Piece { path, near, river });
                    } else {
                        piece.clear();
                    }
                };
                for w in run.windows(2) {
                    let (a, b) = (w[0], w[1]);
                    let t = unit(a, b);
                    let n = left(t);
                    // Heading against the piece 10 m back: no curls around
                    // small coves, turns under 60°.
                    let turn_ok = piece.len() < 6 || {
                        let k = piece.len();
                        let p = unit(piece[k - 6], piece[k - 1]);
                        p.x * t.x + p.y * t.y >= 0.5
                    };
                    let ok = dist(a, b) > 1e-6
                        && turn_ok
                        && !served.along(super::point(a, b, 0.5), t, width * 0.5 + 1.0)
                        && [a, b, super::point(a, b, 0.5)].iter().all(|&p| {
                            !surface.wet(add(p, n, width * 0.5))
                                && !surface.wet(add(p, n, -width * 0.5))
                        })
                        && routing::segment_clear(surface, a, b, grade)
                        && g::segment_within(region, a, b)
                        && [a, b].iter().all(|&p| {
                            // Not at a cliff foot: the land behind the quay
                            // rises no faster than a lane on either side.
                            [1.0, -1.0].iter().all(|&s| {
                                let q = add(p, n, s * 12.0);
                                surface.wet(q)
                                    || (surface.height_at(q) - surface.height_at(p)).abs()
                                        <= 12.0 * cfg.max_lane_grade
                            })
                        });
                    if ok {
                        if piece.is_empty() {
                            piece.push(a);
                        }
                        piece.push(b);
                    } else {
                        flush(&mut piece);
                    }
                }
                flush(&mut piece);
            }
        }
    }
    // The sea or lake front first, then river quays, nearest the centre.
    pieces.sort_by(|a, b| a.river.cmp(&b.river).then(a.near.total_cmp(&b.near)));
    let population = f64::from(site.population.max(1));
    let mut budget = if h.fondamenta {
        f64::INFINITY
    } else {
        h.quay_per_sqrt_pop * population.sqrt() * if port { 1.0 } else { 0.5 }
    } - streets
        .iter()
        .filter(|s| s.role == "quay")
        .map(|s| length(&s.path))
        .sum::<f64>();
    // A sea or lake port keeps its quays on that front: its brooks and
    // streams stay banks (a lagoon town lines every water).
    let sea = pieces.iter().any(|p| !p.river)
        || streets
            .iter()
            .any(|s| s.role == "quay" && !river_side(surface, &s.path))
        || sea_near(regions, surface);
    for mut piece in pieces {
        if budget < MIN {
            break;
        }
        if piece.river && sea && !h.fondamenta {
            continue;
        }
        let l = length(&piece.path);
        if l > budget {
            piece.path = centred(&piece.path, site.center, budget);
        }
        let Some(links) = landing_streets(&mut piece.path, streets, surface, cfg) else {
            continue;
        };
        budget -= length(&piece.path);
        streets.push(Street {
            widths: vec![width; piece.path.len()],
            path: piece.path,
            rank: 1,
            role: "quay".into(),
        });
        streets.extend(links);
    }
}

/// The land left between each quay and its water, as ribbons (path,
/// widths) to cut from the blocks with the street ribbons: the quay edge is
/// the waterline, no garden sliver lies beyond it. Each vertex reaches only
/// as far as the first water on the quay's water side (at most 20 m), so the
/// far bank of a canal is never touched.
pub(in super::super) fn seaward(
    streets: &[Street],
    surface: Surface<'_>,
) -> Vec<(Vec<Point>, Vec<f64>)> {
    let mut out = vec![];
    for q in streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
    {
        let half = q.widths.first().copied().unwrap_or(5.0) * 0.5;
        let k = q.path.len();
        let normal = |i: usize| {
            let (a, b) = (q.path[i.saturating_sub(1)], q.path[(i + 1).min(k - 1)]);
            left(unit(a, b))
        };
        let first_wet = |p: Point, n: Point| {
            (1..=40)
                .map(|j| 0.5 * j as f64)
                .find(|&d| code(surface, add(p, n, d)) != 0)
        };
        let m = k / 2;
        let side = [1.0, -1.0].into_iter().find(|&sg| {
            let n = normal(m);
            first_wet(
                q.path[m],
                Point {
                    x: n.x * sg,
                    y: n.y * sg,
                },
            )
            .is_some()
        });
        let Some(sg) = side else {
            continue;
        };
        let (mut path, mut widths) = (vec![], vec![]);
        for i in 0..k {
            let n = normal(i);
            let n = Point {
                x: n.x * sg,
                y: n.y * sg,
            };
            let d = first_wet(q.path[i], n).unwrap_or(half) + 1.0;
            path.push(add(q.path[i], n, d * 0.5));
            widths.push(d);
        }
        out.push((path, widths));
    }
    out
}

/// Whether sea or lake water lies within 30 m of a quarter edge (vertices
/// sampled, at most 400 per ring, checked on a 10 m grid): the town has a
/// harbour front somewhere.
fn sea_near(regions: &[Shape], surface: Surface<'_>) -> bool {
    regions.iter().any(|r| {
        let step = (r.outer.len() / 400).max(1);
        r.outer.iter().step_by(step).any(|&v| {
            (-3..=3).any(|i| {
                (-3..=3).any(|j| {
                    let p = Point {
                        x: v.x + 10.0 * i as f64,
                        y: v.y + 10.0 * j as f64,
                    };
                    p.x >= 0.0
                        && p.y >= 0.0
                        && p.x < surface.width
                        && p.y < surface.width
                        && matches!(code(surface, p), 1 | 2)
                })
            })
        })
    })
}

/// Whether the water beside a quay (within 15 m of its middle) is a river.
fn river_side(surface: Surface<'_>, path: &[Point]) -> bool {
    let l = length(path);
    let at = sub_path(path, 0.0, l * 0.5);
    let (Some(&p), Some(&q)) = (at.last(), at.get(at.len().saturating_sub(2))) else {
        return false;
    };
    let n = left(unit(q, p));
    (1..=15)
        .flat_map(|d| [add(p, n, d as f64), add(p, n, -(d as f64))])
        .map(|x| code(surface, x))
        .find(|&c| c != 0)
        == Some(3)
}

/// The `budget` metres of `path` centred on its point nearest `c`.
fn centred(path: &[Point], c: Point, budget: f64) -> Vec<Point> {
    let total = length(path);
    let mut s = 0.0;
    let (mut at, mut best) = (0.0, f64::INFINITY);
    for w in path.windows(2) {
        let (d, t, _) = g::distance(c, w[0], w[1]);
        if d < best {
            best = d;
            at = s + t * dist(w[0], w[1]);
        }
        s += dist(w[0], w[1]);
    }
    let from = (at - budget * 0.5).clamp(0.0, (total - budget).max(0.0));
    sub_path(path, from, from + budget)
}
fn sub_path(path: &[Point], from: f64, to: f64) -> Vec<Point> {
    let mut out = vec![];
    let mut s = 0.0;
    for w in path.windows(2) {
        let l = dist(w[0], w[1]);
        let (a, b) = (s, s + l);
        if b >= from && a <= to && l > 1e-9 {
            let p = super::point(w[0], w[1], ((from - a) / l).clamp(0.0, 1.0));
            let q = super::point(w[0], w[1], ((to - a) / l).clamp(0.0, 1.0));
            if out.is_empty() {
                out.push(p);
            }
            if dist(*out.last().unwrap(), q) > 1e-6 {
                out.push(q);
            }
        }
        s = b;
    }
    out
}

/// Landing streets from a quay to the nearest town street, about every
/// 120 m and at least one; their junctions become quay vertices. `None` when
/// no landing street can be laid (the quay would be cut off).
fn landing_streets(
    path: &mut Vec<Point>,
    streets: &[Street],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
) -> Option<Vec<Street>> {
    const EVERY: f64 = 120.0;
    let total = length(path);
    let town: Vec<Street> = streets
        .iter()
        .filter(|s| s.role != "quay" && s.path.len() >= 2)
        .cloned()
        .collect();
    if town.is_empty() {
        return None;
    }
    let stations = (total / EVERY).ceil().max(1.0) as usize;
    let mut links = vec![];
    let mut joints: Vec<(f64, Point)> = vec![];
    for k in 0..stations {
        // Try the station and points around it within its share of the quay.
        let base = total * (k as f64 + 0.5) / stations as f64;
        let span = total / stations as f64 * 0.45;
        let found = (0..9).find_map(|j| {
            let off = span * [0.0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1.0, -1.0][j];
            let s = (base + off).clamp(0.0, total);
            let p = sub_path(path, 0.0, s).last().copied().unwrap_or(path[0]);
            let (d, q, _) = super::nearest(p, &town)?;
            (d < 80.0 && (d <= 1.0 || routing::segment_clear(surface, p, q, cfg.max_street_grade)))
                .then_some((s, p, q, d))
        });
        if let Some((s, p, q, d)) = found {
            joints.push((s, p));
            if d > 1.0 {
                links.push(Street {
                    path: vec![p, q],
                    widths: vec![4.0; 2],
                    rank: 2,
                    role: "street".into(),
                });
            }
        }
    }
    if joints.is_empty() {
        return None;
    }
    // Insert the junctions as quay vertices, from the far end so indices hold.
    joints.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (s, p) in joints {
        let mut acc = 0.0;
        for i in 0..path.len() - 1 {
            let l = dist(path[i], path[i + 1]);
            if s <= acc + l + 1e-9 {
                if dist(p, path[i]) > 1e-6 && dist(p, path[i + 1]) > 1e-6 {
                    path.insert(i + 1, p);
                }
                break;
            }
            acc += l;
        }
    }
    Some(links)
}

/// Piers, landing stages and moles from the quays of a finished street
/// network. A pier stands square to its quay every `pier_spacing` (denser in
/// a larger port), wholly over water with open water beyond it, never across
/// another street or bridge; on rivers and canals, and in small or lagoon
/// towns, it is a short landing stage that leaves the channel free (water at
/// least three stage lengths wide beyond it). A sea port of 6 000 people or
/// more whose culture builds basins gets two moles enclosing a basin in front
/// of its longest straight quay, when both stand on water.
pub(in super::super) fn works(
    streets: &[Street],
    surface: Surface<'_>,
    site: &Site,
    culture: &str,
) -> Vec<Street> {
    let h = params(culture);
    let quays: Vec<&Street> = streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
        .collect();
    if quays.is_empty() {
        return vec![];
    }
    let population = f64::from(site.population.max(1));
    let small = population < 3000.0 || h.fondamenta;
    let spacing = h.pier_spacing * (10_000.0 / population).sqrt().clamp(0.6, 1.8);
    let limit = ((population / 1500.0).ceil() as usize).clamp(1, 40);
    let segments: Vec<(Point, Point)> = streets
        .iter()
        .flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1])))
        .collect();
    let crosses = |a: Point, b: Point, own: &[(Point, Point)]| {
        segments
            .iter()
            .chain(own.iter())
            .any(|&(c, d)| g::segment_hit(a, b, c, d).is_some_and(|(t, _)| t > 0.05))
    };
    // Open water from `p` along `n` over `[from, to]`, every 2 m.
    let open = |p: Point, n: Point, from: f64, to: f64, kind: u8| {
        let m = ((to - from) / 2.0).ceil().max(1.0) as usize;
        (0..=m).all(|k| {
            let q = add(p, n, from + (to - from) * k as f64 / m as f64);
            let c = code(surface, q);
            c != 0 && (c == kind || kind != 3 && c != 3)
        })
    };
    let mut out: Vec<Street> = vec![];
    let mut own: Vec<(Point, Point)> = vec![];
    let mut roots: Vec<Point> = vec![];
    // Moles first: they claim the best front.
    if h.basin && !small && population >= 6000.0 {
        let best = quays
            .iter()
            .map(|q| (q, dist(q.path[0], *q.path.last().unwrap())))
            .filter(|(q, chord)| *chord >= 100.0 && *chord >= 0.85 * length(&q.path))
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((q, chord)) = best {
            let (a, b) = (q.path[0], *q.path.last().unwrap());
            let w = q.widths.first().copied().unwrap_or(6.0) * 0.5;
            let t = unit(a, b);
            let n = [left(t), Point { x: t.y, y: -t.x }]
                .into_iter()
                .find(|&n| code(surface, add(super::point(a, b, 0.5), n, w + 3.0)) != 0);
            if let Some(n) = n {
                let reach = (0.35 * chord).clamp(40.0, 160.0);
                let arm = 0.3 * chord;
                let a0 = add(a, n, w);
                let b0 = add(b, n, w);
                let a1 = add(a0, n, reach);
                let b1 = add(b0, n, reach);
                let a2 = add(a1, t, arm);
                let b2 = add(b1, t, -arm);
                let wet = |p: Point, q: Point| open(p, unit(p, q), 0.0, dist(p, q), 1);
                let sea = |p: Point| code(surface, p) == 1;
                if sea(add(a0, n, 4.0))
                    && sea(add(b0, n, 4.0))
                    && wet(add(a0, n, 4.0), a1)
                    && wet(a1, a2)
                    && wet(add(b0, n, 4.0), b1)
                    && wet(b1, b2)
                    && !crosses(a, a2, &own)
                    && !crosses(b, b2, &own)
                {
                    for path in [vec![a, a1, a2], vec![b, b1, b2]] {
                        own.extend(path.windows(2).map(|w| (w[0], w[1])));
                        roots.push(path[0]);
                        out.push(Street {
                            widths: vec![8.0; path.len()],
                            path,
                            rank: 2,
                            role: "mole".into(),
                        });
                    }
                }
            }
        }
    }
    let mut piers = 0;
    for q in &quays {
        let w = q.widths.first().copied().unwrap_or(6.0) * 0.5;
        let total = length(&q.path);
        // Every quay of 40 m or more has at least one pier or landing stage.
        let stations = (total / spacing)
            .floor()
            .max(if total >= 40.0 { 1.0 } else { 0.0 }) as usize;
        for k in 0..stations {
            if piers >= limit {
                break;
            }
            let s = total * (k as f64 + 0.5) / stations as f64;
            let near = sub_path(&q.path, 0.0, s);
            let (Some(&p), Some(&prev)) = (near.last(), near.get(near.len().saturating_sub(2)))
            else {
                continue;
            };
            if dist(p, prev) < 1e-6 || roots.iter().any(|&r| dist(r, p) < spacing * 0.6) {
                continue;
            }
            let t = unit(prev, p);
            // The water side and where its water begins (the quay edge, or a
            // raster step beyond it).
            let Some((n, kind, d0)) =
                [left(t), Point { x: t.y, y: -t.x }]
                    .into_iter()
                    .find_map(|n| {
                        (0..=12).map(|k| w + 0.5 + k as f64).find_map(|d| {
                            let c = code(surface, add(p, n, d));
                            (c != 0).then_some((n, c, d))
                        })
                    })
            else {
                continue;
            };
            let landing = small || kind == 3;
            let wanted = if landing {
                (h.pier_length.0 * 0.5).clamp(6.0, 14.0)
            } else {
                let x = ((population - 3000.0) / 30_000.0).clamp(0.0, 1.0);
                h.pier_length.0 + (h.pier_length.1 - h.pier_length.0) * x
            };
            // The longest admissible length down to two thirds of the wanted
            // one: open water along it and beyond (a free channel).
            let beyond = |l: f64| if landing { 2.0 * l } else { 20.0 };
            let Some(l) = [1.0, 0.85, 0.67]
                .iter()
                .map(|f| wanted * f)
                .find(|&l| open(p, n, d0, d0 + l + beyond(l), kind))
            else {
                continue;
            };
            let end = add(p, n, d0 + l);
            if crosses(add(p, n, w + 0.5), end, &own) {
                continue;
            }
            own.push((p, end));
            roots.push(p);
            piers += 1;
            out.push(Street {
                path: vec![p, end],
                widths: vec![if landing { 3.0 } else { 5.0 }; 2],
                rank: 3,
                role: if landing { "landing" } else { "pier" }.into(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sea to the west of x = 128 m on a 256 m flat map; land elsewhere.
    fn coast(n: usize) -> (Vec<f32>, Vec<u8>) {
        let height = vec![1.0; n * n];
        let water = (0..n * n)
            .map(|i| u8::from(((i % n) as f64 + 0.5) * 256.0 / n as f64 / 4.0 < 32.0))
            .collect();
        (height, water)
    }

    /// A port's waterfront is one continuous quay (its budget of the shore,
    /// nearest the centre), joined to the streets, with piers into open water
    /// at intervals, wholly over water; an inland quarter gets none.
    #[test]
    fn a_port_waterfront_is_a_continuous_quay_with_piers() {
        let n = 64;
        let (height, water) = coast(n);
        let surface = Surface {
            geometry: None,
            width: 256.0,
            n,
            height: &height,
            water: &water,
        };
        // A stair-stepped raster shore (4 m cells, 12 m steps) at x ≈ 128.
        let mut outer = vec![
            Point { x: 128.0, y: 8.0 },
            Point { x: 250.0, y: 8.0 },
            Point { x: 250.0, y: 248.0 },
        ];
        let mut y = 248.0;
        while y > 8.0 {
            let x = if ((y / 12.0) as i64) % 2 == 0 {
                128.0
            } else {
                132.0
            };
            outer.push(Point { x, y });
            y -= 12.0;
            outer.push(Point { x, y });
        }
        let region = g::normalized(Shape {
            outer,
            holes: vec![],
        });
        let road = Street {
            path: vec![Point { x: 175.0, y: 10.0 }, Point { x: 175.0, y: 246.0 }],
            widths: vec![5.0; 2],
            rank: 1,
            role: "street".into(),
        };
        let mut cfg = LayoutConfig::default();
        cfg.programme.role = "port".into();
        let site = Site {
            key: "port".into(),
            name: String::new(),
            population: 2000,
            culture: "european-organic".into(),
            center: Point { x: 180.0, y: 128.0 },
            radius: 200.0,
        };
        let mut streets = vec![road.clone()];
        quays(
            &[region.clone()],
            &mut streets,
            surface,
            &cfg,
            &site,
            "european-organic",
            true,
        );
        let quay: Vec<_> = streets.iter().filter(|s| s.role == "quay").collect();
        assert_eq!(quay.len(), 1, "one continuous quay");
        let l = length(&quay[0].path);
        let budget = 6.0 * 2000f64.sqrt();
        assert!(
            l > 0.9 * budget.min(200.0) && l <= budget + 1.0,
            "quay {l} m"
        );
        assert!(routing::path_clear(surface, &quay[0].path, 0.05));
        for ribbon in g::ribbon(&quay[0].path, &quay[0].widths) {
            let dry: f64 = g::dry_clip(&surface, &ribbon).iter().map(g::area).sum();
            assert!(g::area(&ribbon) - dry <= 1e-3, "quay platform on dry land");
        }
        // Within 12 m of the water along its whole length.
        assert!(quay[0].path.iter().all(|p| p.x < 128.0 + 14.0));
        let joined = streets
            .iter()
            .filter(|s| s.role == "street" && s.path.len() == 2)
            .filter(|s| quay[0].path.contains(&s.path[0]))
            .count();
        assert!(joined >= 1, "landing streets reach the quay");
        let piers = works(&streets, surface, &site, "european-organic");
        assert!(!piers.is_empty());
        for p in &piers {
            let root = p.path[0];
            assert!(
                quay[0]
                    .path
                    .windows(2)
                    .any(|w| g::distance(root, w[0], w[1]).0 < 1e-6)
            );
            let end = *p.path.last().unwrap();
            assert!(surface.wet(end) && surface.wet(point_on(p, 0.7)));
        }
        // Inland quarter, 20 m from the water: no quay.
        let inland = g::normalized(Shape {
            outer: vec![
                Point { x: 152.0, y: 8.0 },
                Point { x: 250.0, y: 8.0 },
                Point { x: 250.0, y: 248.0 },
                Point { x: 152.0, y: 248.0 },
            ],
            holes: vec![],
        });
        let mut streets = vec![road];
        quays(
            &[inland],
            &mut streets,
            surface,
            &cfg,
            &site,
            "european-organic",
            true,
        );
        assert!(!streets.iter().any(|s| s.role == "quay"));
    }
    /// A domain stopping short of its water joins the waterline across a
    /// gentle gap, not down a cliff.
    #[test]
    fn the_harbour_apron_reaches_the_waterline_but_not_down_a_cliff() {
        let n = 64;
        let (height, water) = coast(n);
        let surface = Surface {
            geometry: None,
            width: 256.0,
            n,
            height: &height,
            water: &water,
        };
        let domain = g::rectangle(150.0, 40.0, 240.0, 200.0);
        let cfg = LayoutConfig::default();
        let wide = apron(&domain, surface, &cfg, 50.0);
        let (x0, _, _, _) = g::bbox(&wide);
        assert!(x0 < 131.0 && x0 >= 127.9, "apron edge at {x0}");
        assert!(g::area(&wide) > g::area(&domain) + 0.9 * 22.0 * 150.0);
        let dry: f64 = g::dry_clip(&surface, &wide).iter().map(g::area).sum();
        assert!((dry - g::area(&wide)).abs() < 1.0, "apron on dry land");
        // The gap is a 20 m cliff: nothing is added.
        let cliff: Vec<f32> = (0..n * n)
            .map(|i| if (i % n) * 4 < 140 { 1.0 } else { 21.0 })
            .collect();
        let steep = Surface {
            height: &cliff,
            ..surface
        };
        assert!((g::area(&apron(&domain, steep, &cfg, 50.0)) - g::area(&domain)).abs() < 1.0);
    }
    fn point_on(s: &Street, t: f64) -> Point {
        super::super::point(s.path[0], *s.path.last().unwrap(), t)
    }

    /// An inland port moves to its gentle shore; a cliff shore is refused
    /// and a town already on its water stays.
    #[test]
    fn an_inland_port_stands_on_its_shore_never_at_a_cliff() {
        let n = 256;
        let width = 2048.0;
        let cell = width / n as f64;
        let water: Vec<u8> = (0..n * n)
            .map(|i| u8::from(((i % n) as f64 + 0.5) * cell < 400.0))
            .collect();
        let gentle = vec![2.0f32; n * n];
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &gentle,
            water: &water,
        };
        let mut cfg = LayoutConfig::default();
        cfg.programme.role = "port".into();
        let site = Site {
            key: "p".into(),
            name: String::new(),
            population: 8000,
            culture: "european-organic".into(),
            center: Point {
                x: 1200.0,
                y: 1000.0,
            },
            radius: 600.0,
        };
        let moved = sited(&site, &cfg, surface).expect("moves to its shore");
        let d = moved.center.x - 400.0;
        assert!((d - front_distance(600.0)).abs() < 12.0, "front at {d} m");
        assert!((moved.center.y - 1000.0).abs() < 10.0);
        // Not a port: stays.
        assert!(sited(&site, &LayoutConfig::default(), surface).is_none());
        // Already on the water: stays.
        let near = Site {
            center: Point {
                x: 520.0,
                y: 1000.0,
            },
            ..site.clone()
        };
        assert!(sited(&near, &cfg, surface).is_none());
        // A cliff: the land rises 40 m within 20 m of the bank.
        let cliff: Vec<f32> = (0..n * n)
            .map(|i| {
                if ((i % n) as f64 + 0.5) * cell < 416.0 {
                    2.0
                } else {
                    42.0
                }
            })
            .collect();
        let steep = Surface {
            height: &cliff,
            ..surface
        };
        assert!(sited(&site, &cfg, steep).is_none());
    }
}
