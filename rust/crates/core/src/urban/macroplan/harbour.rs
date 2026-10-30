//! Harbour works of a port town, by construction: the town stands on its
//! water (`sited`), its waterfront is a continuous stone quay between the
//! water and the first row of lots (`quays`), and piers, landing stages or
//! moles project from the quays into the water (`works`). Lengths, widths and
//! spacings scale with the port's population and come from the culture's
//! `plan.harbour` entry in the catalogue (defaults below).
use super::super::{LayoutConfig, Point, Shape, Site, Street, Surface, geometry as g, routing};
#[path = "harbour_shelter.rs"]
mod shelter;
#[path = "harbour_parameters.rs"]
mod placement;
pub(in super::super) use placement::{extend, blocks as port_blocks};

pub(in super::super) fn shelter_weight(cfg: &LayoutConfig) -> f64 {
    cfg.port_shelter.unwrap_or(f64::from(cfg.sheltered_harbour))
}
pub(in super::super) fn parameterized(cfg: &LayoutConfig) -> bool {
    cfg.port_detachment < 1.0 || shelter_weight(cfg) > 0.0
}

// A navigable-water score alone also accepts lines entirely out at sea.
fn shore_front(path:&[Point],surface:Surface<'_>)->bool {
    if path.len()<2 {return false;}
    let reach=20.0+2.0*surface.width/surface.n as f64;
    [0.0,0.25,0.5,0.75,1.0].into_iter().all(|f| {
        let at=sub_path(path,0.0,length(path)*f);
        let p=*at.last().unwrap_or(&path[0]);
        if surface.wet(p) {return false;}
        let i=at.len().saturating_sub(2);
        let t=if at.len()>1 {unit(at[i],p)} else {unit(path[0],path[1])};
        [left(t),Point{x:t.y,y:-t.x}].into_iter().any(|n|
            (1..=reach.ceil() as usize).any(|d|surface.wet(add(p,n,d as f64))))
    })
}

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

/// A port: its site archetype, declared port siting or a port function.
/// Waterfront cultures (`plan.waterfront`) build quays as well.
pub(in super::super) fn port_town(cfg: &LayoutConfig) -> bool {
    matches!(cfg.site_archetype.as_str(), "harbor" | "lakeshore" | "bridge")
        || cfg.programme.navigable_access
        || cfg
            .programme
            .functions
            .as_ref()
            .is_some_and(|f| f.port > 0.0)
}

fn code(surface: Surface<'_>, p: Point) -> u8 {
    if p.x < 0.0 || p.y < 0.0 || p.x >= surface.width || p.y >= surface.width {
        return 0;
    }
    let x = (p.x / surface.width * surface.n as f64) as usize;
    let y = (p.y / surface.width * surface.n as f64) as usize;
    let c = surface.water[y.min(surface.n - 1) * surface.n + x.min(surface.n - 1)];
    if c != 0 || !surface.wet(p) { return c; }
    // Vector shore margins can be wet inside a dry raster cell. Keep the
    // nearest water kind, otherwise a river margin is mistaken for a sea.
    let mut nearest = (f64::INFINITY, 1);
    let cell = surface.width / surface.n as f64;
    for j in y.saturating_sub(2)..=(y + 2).min(surface.n - 1) {
        for i in x.saturating_sub(2)..=(x + 2).min(surface.n - 1) {
            let kind = surface.water[j * surface.n + i];
            let d = dist(p, Point { x: (i as f64 + 0.5) * cell, y: (j as f64 + 0.5) * cell });
            if kind != 0 && d < nearest.0 { nearest = (d, kind); }
        }
    }
    nearest.1
}

/// Distance from the town centre to its harbour front: the core reaches the
/// water, with land behind it.
fn front_distance(radius: f64) -> f64 {
    (0.12 * radius).clamp(50.0, 110.0)
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
    if !port_town(cfg) || surface.n < 2 || surface.wet(site.center)
        || site.population >= 3000 && parameterized(cfg) {
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
            let open = if w == 3 { NAVIGABLE } else { 40.0 };
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
    let kind = if cfg.site_archetype == "bridge" && !banks[1].is_empty() { 1 } else { usize::from(banks[0].is_empty()) };
    let mut chosen = std::mem::take(&mut banks[kind]);
    if cfg.sheltered_harbour {chosen.extend(std::mem::take(&mut banks[1-kind]));}
    let mut banks = chosen;
    banks.sort_by(|a, b| a.0.total_cmp(&b.0));
    if cfg.sheltered_harbour {shelter::rank_banks(&mut banks,surface,site);}
    if std::env::var("URBAN_PROFILE").is_ok() { eprintln!("harbour banks={} nearest={:?}", banks.len(), banks.first().map(|b|b.0)); }
    // Within about a block of the water the town already fronts it.
    if banks.first().is_none_or(|b| b.0 <= reach.max(120.0)) {
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
    let (_, center, _) = if cfg.sheltered_harbour {found.into_iter().next()}
        else {found.into_iter().max_by_key(|f| f.0)}?;
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

/// The 60 m of land behind a quay point climbs at most a street grade per
/// 12 m, so the town reaches its quay on a gentle slope (the same strip `sited`
/// requires of an inland port's bank).
fn gentle_behind(surface: Surface<'_>, p: Point, n: Point, side: f64, grade: f64) -> bool {
    (0..5).all(|k| {
        let a = add(p, n, side * 12.0 * k as f64);
        let b = add(p, n, side * 12.0 * (k + 1) as f64);
        surface.wet(b) || (surface.height_at(b) - surface.height_at(a)).abs() <= 12.0 * grade
    })
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
    _port: bool,
) {
    const MIN: f64 = 20.0;
    let inherited: Vec<Street> = if parameterized(cfg) {
        let quays = streets.iter().filter(|s|s.role=="quay").cloned().collect();
        streets.retain(|s|s.role!="quay");
        quays
    } else {vec![]};
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
    let mut rejected=[0usize;5];
    // Existing quays are served. An ordinary shoreline street still needs
    // a quay platform; long quay streets are binned once.
    let existing: Vec<Street> = streets.iter().filter(|s| s.role == "quay").cloned().collect();
    let served = Index::new(&existing);
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
                        // A brook or ditch is a bank, not a harbour front:
                        // no boat berths where the water is not navigable.
                        if channel_width(surface, &path) >= NAVIGABLE {
                            pieces.push(Piece { path, near, river });
                        }
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
                                        && gentle_behind(surface, p, n, s, cfg.max_street_grade)
                            })
                        });
                    if !ok && std::env::var_os("URBAN_PROFILE").is_some() {
                        rejected[0]+=1;
                        if !turn_ok {rejected[1]+=1;}
                        if !routing::segment_clear(surface,a,b,grade) {rejected[2]+=1;}
                        if !g::segment_within(region,a,b) {rejected[3]+=1;}
                        if [a,b].iter().any(|&p|surface.wet(add(p,n,width*0.5))||surface.wet(add(p,n,-width*0.5))) {rejected[4]+=1;}
                    }
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
    if parameterized(cfg) {
        pieces.extend(inherited.into_iter().map(|s|Piece {near:s.path.iter().map(|&p|dist(p,site.center)).fold(f64::INFINITY,f64::min),river:river_side(surface,&s.path),path:s.path}));
        placement::select(&mut pieces,regions,streets,surface,site,cfg);
    }
    pieces.sort_by(|a, b| a.river.cmp(&b.river).then(a.near.total_cmp(&b.near)));
    let population = f64::from(site.population.max(1));
    let mut budget = if h.fondamenta {
        f64::INFINITY
    } else {
        h.quay_per_sqrt_pop * population.sqrt()
    } - streets
        .iter()
        .filter(|s| s.role == "quay")
        .map(|s| length(&s.path))
        .sum::<f64>();
    if std::env::var_os("URBAN_PROFILE").is_some() {eprintln!("harbour quay pieces={} rejected/turn/grade/domain/wet={rejected:?}",pieces.len());}
    for mut piece in pieces {
        if budget < MIN {
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
    join_fronts(streets,surface,grade);
}

/// Quarter seams must not interrupt the same bank. Join only short, dry,
/// grade-safe gaps with navigable water beside them, never across a channel.
fn join_fronts(streets: &mut Vec<Street>, surface: Surface<'_>, grade: f64) {
    loop {
        let mut joined=None;
        'pairs: for i in 0..streets.len() {
            if streets[i].role!="quay" {continue;}
            for j in i+1..streets.len() {
                if streets[j].role!="quay" {continue;}
                for (a,b) in [(false,false),(false,true),(true,false),(true,true)] {
                    let si=&streets[i]; let sj=&streets[j];
                    let p=if a {si.path[0]} else {*si.path.last().unwrap()};
                    let q=if b {*sj.path.last().unwrap()} else {sj.path[0]};
                    let d=dist(p,q);
                    if d>20.0 {continue;}
                    let width=si.widths.iter().chain(&sj.widths).copied().fold(0.0,f64::max);
                    let n=left(unit(p,q));
                    let dry=d<0.01 || (routing::segment_clear(surface,p,q,grade)
                        && (0..=(d/2.0).ceil() as usize).all(|k| {
                            let x=super::point(p,q,k as f64/(d/2.0).ceil().max(1.0));
                            !surface.wet(add(x,n,width*0.5)) && !surface.wet(add(x,n,-width*0.5))
                        }) && channel_width(surface,&[p,q])>=NAVIGABLE);
                    if dry {joined=Some((i,j,a,b,width));break 'pairs;}
                }
            }
        }
        let Some((i,j,a,b,width))=joined else {break};
        let mut other=streets.remove(j);
        if a {streets[i].path.reverse();}
        if b {other.path.reverse();}
        streets[i].path.extend(other.path);
        streets[i].path.dedup_by(|a,b|dist(*a,*b)<0.01);
        streets[i].widths=vec![width;streets[i].path.len()];
    }
}

/// The land left between each quay and its water, as ribbons (path,
/// widths) to cut from the blocks with the street ribbons: the quay edge is
/// the waterline, no garden sliver lies beyond it. Each vertex reaches only
/// as far as the first water on the quay's water side (two raster cells plus
/// 20 m), so the
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
            (1..=((surface.width / surface.n as f64 * 2.0 + 20.0) * 2.0).ceil() as usize)
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

/// Narrowest water a quay may front (m): two barges' beams and the way
/// between them. A stream narrower than this is crossed and banked, not
/// berthed.
const NAVIGABLE: f64 = 10.0;

/// Width of the water beside a quay (m): across the first water met within
/// 15 m and two raster cells of the path, square to it, at a quarter, half and three quarters of
/// its length; the median of the three (the open sea counts as wide).
fn channel_width(surface: Surface<'_>, path: &[Point]) -> f64 {
    // The quay stands back from the raster shore by up to a cell or two.
    let reach = 15.0 + 2.0 * surface.width / surface.n as f64;
    let l = length(path);
    let mut widths: Vec<f64> = [0.25, 0.5, 0.75]
        .iter()
        .filter_map(|&f| {
            let at = sub_path(path, 0.0, l * f);
            let (&p, &q) = (at.last()?, at.get(at.len().checked_sub(2)?)?);
            let n = left(unit(q, p));
            let across = |s: f64| {
                let first = (1..=(2.0 * reach) as usize)
                    .map(|k| k as f64 * 0.5)
                    .find(|&d| surface.wet(add(p, n, s * d)))?;
                let mut d = first;
                while d < first + 200.0 && surface.wet(add(p, n, s * (d + 0.5))) {
                    d += 0.5;
                }
                Some(d + 0.5 - first)
            };
            across(1.0).into_iter().chain(across(-1.0)).reduce(f64::max)
        })
        .collect();
    widths.sort_by(f64::total_cmp);
    widths.get(widths.len() / 2).copied().unwrap_or(0.0)
}

/// Whether the water beside a quay (15 m plus two raster cells) is a river.
fn river_side(surface: Surface<'_>, path: &[Point]) -> bool {
    let l = length(path);
    let at = sub_path(path, 0.0, l * 0.5);
    let (Some(&p), Some(&q)) = (at.last(), at.get(at.len().saturating_sub(2))) else {
        return false;
    };
    let n = left(unit(q, p));
    (1..=(15.0 + 2.0 * surface.width / surface.n as f64).ceil() as usize)
        .flat_map(|d| [add(p, n, d as f64), add(p, n, -(d as f64))])
        .map(|x| code(surface, x))
        .find(|&c| c != 0)
        == Some(3)
}

/// Physical water served by a quay, across its embankment apron.
pub(in super::super) fn front_water(surface: Surface<'_>, path: &[Point]) -> Option<(&'static str, f64)> {
    let at = sub_path(path, 0.0, length(path) * 0.5);
    let (&p, &previous) = (at.last()?, at.get(at.len().checked_sub(2)?)?);
    let n = left(unit(previous, p));
    let reach = (20.0 + 2.0 * surface.width / surface.n as f64).ceil() as usize;
    (1..=reach).flat_map(|d| [add(p, n, d as f64), add(p, n, -(d as f64))])
        .find_map(|q| match code(surface, q) {
            1 => Some(("sea", surface.height_at(q))),
            2 => Some(("lake", surface.height_at(q))),
            3 => Some(("river", surface.height_at(q))),
            _ => None,
        })
}

pub(in super::super) fn navigable(layout: &super::super::Layout, surface: Surface<'_>) -> bool {
    layout.streets.iter().any(|s| s.role == "quay" && channel_width(surface, &s.path) >= NAVIGABLE)
}

pub(in super::super) fn crosses_sea(surface: Surface<'_>, a: Point, b: Point) -> bool {
    let steps=(dist(a,b)/2.0).ceil().max(1.0) as usize;
    (0..=steps).any(|k| {let p=super::point(a,b,k as f64/steps as f64);surface.wet(p) && code(surface,p)==1})
}

/// New watercourse crossings cannot become bridges across a sea harbour.
/// An explicitly imported marine span keeps its own regional provenance.
pub(in super::super) fn keep_sea_access(streets: &mut Vec<Street>, surface: Surface<'_>, roads: &[Street]) {
    streets.retain(|s| {
        if !matches!(s.role.as_str(),"bridge"|"causeway"|"ford") || !s.path.windows(2).any(|w|crosses_sea(surface,w[0],w[1])) {return true;}
        let p=super::point(s.path[0],*s.path.last().unwrap(),0.5);
        roads.iter().filter(|r|matches!(r.role.as_str(),"bridge"|"causeway"))
            .any(|r|r.path.windows(2).any(|w|g::distance(p,w[0],w[1]).0<2.0))
    });
}

pub(in super::super) fn protect_navigation(layout: &mut super::super::Layout, surface: Surface<'_>, roads: &[Street]) {
    let reserved:Vec<_>=layout.programme.iter().flat_map(|p|&p.reservations).map(|r|layout.streets.get(r.street).cloned()).collect();
    keep_sea_access(&mut layout.streets,surface,roads);
    if let Some(p)=&mut layout.programme {
        for (r,old) in p.reservations.iter_mut().zip(reserved) {
            if let Some(index)=old.and_then(|old|layout.streets.iter().position(|s|s.role==old.role && s.path==old.path)) {r.street=index;}
        }
    }
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
    works_with_minimum(streets,surface,site,culture,40.0)
}

fn works_with_minimum(streets: &[Street], surface: Surface<'_>, site: &Site, culture: &str, minimum: f64) -> Vec<Street> {
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
        .flat_map(|s| s.path.windows(2).filter(|w| matches!(s.role.as_str(),"pier"|"mole"|"landing"|"bridge"|"causeway")
            || surface.wet(super::point(w[0],w[1],0.5))).map(|w| (w[0], w[1])))
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
    if (h.basin || !h.fondamenta) && !small && population >= 6000.0 {
        let best = quays
            .iter()
            .filter(|q|front_water(surface,&q.path).is_some_and(|(kind,_)|kind=="sea"))
            .map(|q| (q, dist(q.path[0], *q.path.last().unwrap())))
            .filter(|(q, chord)| *chord >= (population.sqrt()*0.5).clamp(40.0,100.0) && *chord >= 0.85 * length(&q.path))
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((q, chord)) = best {
            let (a, b) = (q.path[0], *q.path.last().unwrap());
            let w = q.widths.first().copied().unwrap_or(6.0) * 0.5;
            let t = unit(a, b);
            let n = [left(t), Point { x: t.y, y: -t.x }]
                .into_iter()
                .filter_map(|n| (0..=(2.0*surface.width/surface.n as f64+20.0).ceil() as usize)
                    .map(|k|w+0.5+k as f64).find(|&d|code(surface,add(super::point(a,b,0.5),n,d))==1).map(|d|(d,n)))
                .min_by(|a,b|a.0.total_cmp(&b.0)).map(|(_,n)|n);
            if let Some(n) = n {
                let reach = (0.35 * chord).clamp(40.0, 160.0);
                let arm = 0.3 * chord;
                let start = |p| (0..=(2.0 * surface.width / surface.n as f64 + 20.0).ceil() as usize)
                    .map(|k| w + 0.5 + k as f64).find(|&d| code(surface, add(p, n, d)) == 1);
                if let (Some(da), Some(db)) = (start(a), start(b)) {
                let a0 = add(a, n, da);
                let b0 = add(b, n, db);
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
                            widths: vec![(population.sqrt() * 0.08).clamp(3.0, 12.0); path.len()],
                            path,
                            rank: 2,
                            role: "mole".into(),
                        });
                    }
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
            .max(if total >= minimum { 1.0 } else { 0.0 }) as usize;
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
                        (0..=(2.0 * surface.width / surface.n as f64 + 20.0).ceil() as usize).map(|k| w + 0.5 + k as f64).find_map(|d| {
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

pub(in super::super) fn configured_works(streets: &[Street], surface: Surface<'_>, site: &Site, culture: &str, cfg: &LayoutConfig) -> Vec<Street> {
    if parameterized(cfg) {shelter::works(streets,surface,site,culture)}
    else {works(streets,surface,site,culture)}
}

/// A platform is cadastral geometry, not the casing of a street.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Quay {
    pub kind: String,
    pub shape: Shape,
    pub deck_z_m: f64,
    pub material: String,
}

/// Open the curtain where a landing street actually crosses it, before the
/// fortification pass caps streets against closed curtains.
pub(in super::super) fn open_gates(layout: &mut super::super::Layout) {
    let fronts: Vec<Point> = layout.streets.iter().filter(|s| s.role == "quay")
        .flat_map(|s| s.path.iter().copied()).collect();
    for st in &layout.streets {
        if !st.path.iter().any(|p| fronts.iter().any(|&q| dist(*p, q) < 1.0)) { continue; }
        for e in &mut layout.enclosures {
            for w in st.path.windows(2) {
                for edge in e.path.windows(2) {
                    if let Some((_, p)) = g::segment_hit(w[0], w[1], edge[0], edge[1])
                        && !e.gates.iter().any(|&q| dist(p, q) < 4.0) {
                        e.gates.push(p);
                    }
                }
            }
        }
    }
}

/// Keep the entire apron between the quay street and the water, including
/// the raster shore margin that is cut from building blocks by `seaward`.
pub(in super::super) fn platforms(layout: &mut super::super::Layout, surface: Surface<'_>) {
    let mut platforms = vec![];
    let aprons = seaward(&layout.streets, surface);
    let quay_ribbons: Vec<Shape> = layout.streets.iter().filter(|s| s.role == "quay")
        .flat_map(|s| g::ribbon(&s.path, &s.widths)).chain(aprons.iter().flat_map(|(p, w)| g::ribbon(p, w))).collect();
    let mut add = |shape: Shape, kind: &str, material: &str| {
        // Local bank-height fallback; retained terrain replaces it with physical water levels.
        let wet: Vec<f64> = shape.outer.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p)).collect();
        let level = if wet.is_empty() { shape.outer.iter().map(|&p| surface.height_at(p)).fold(f64::INFINITY, f64::min) }
            else { wet.into_iter().fold(f64::INFINITY, f64::min) };
        if level.is_finite() { platforms.push(Quay { kind: kind.into(), shape, deck_z_m: level + 1.0, material: material.into() }); }
    };
    for shape in g::union(&quay_ribbons) {
        let (lo, hi) = shape.outer.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), z| (lo.min(z), hi.max(z)));
        if hi - lo <= 0.8 { add(shape, "quay", "stone"); continue; }
        // Long rivers descend: local slabs follow the water rather than one
        // level platform disappearing under the upstream bank.
        let (x0, y0, x1, y1) = g::bbox(&shape);
        let horizontal = x1 - x0 > y1 - y0;
        let (start, end) = if horizontal { (x0, x1) } else { (y0, y1) };
        let mut at = start;
        while at < end {
            let next = (at + 40.0).min(end);
            let tile = if horizontal { g::rectangle(at, y0 - 1.0, next, y1 + 1.0) }
                else { g::rectangle(x0 - 1.0, at, x1 + 1.0, next) };
            for part in g::intersection(&shape, &tile) { add(part, "quay", "stone"); }
            at = next;
        }
    }
    for st in layout.streets.iter().filter(|s| matches!(s.role.as_str(), "pier" | "landing" | "mole")) {
        for shape in g::ribbon(&st.path, &st.widths) { add(shape, &st.role, if st.role == "mole" { "stone" } else { "timber" }); }
    }
    if let Some(structure) = layout.structure.as_mut() { structure.quays = platforms; }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quay_frontage_and_landing_works_scale_with_population() {
        let (height,water)=coast(256);
        let surface=Surface {geometry:None,width:256.,n:256,height:&height,water:&water};
        let domain=g::rectangle(128.,4.,254.,252.);
        let cfg=LayoutConfig {site_archetype:"harbor".into(),..Default::default()};
        let mut lengths=vec![];
        let mut counts=vec![];
        let mut building_need=vec![];
        for pop in [500,10_000] {
            let site=Site {key:"scale".into(),name:String::new(),population:pop,culture:"hanseatic".into(),center:Point{x:180.,y:128.},radius:120.};
            let mut streets=vec![Street {path:vec![Point{x:180.,y:4.},Point{x:180.,y:252.}],widths:vec![5.;2],rank:1,role:"street".into()}];
            quays(std::slice::from_ref(&domain),&mut streets,surface,&cfg,&site,"hanseatic",true);
            let metres:f64=streets.iter().filter(|s|s.role=="quay").map(|s|length(&s.path)).sum();
            assert!(metres>50.);
            let works=works(&streets,surface,&site,"hanseatic");
            assert!(!works.is_empty());
            if pop==500 { assert!(works.iter().all(|s|s.role=="landing")); }
            else { assert!(works.iter().any(|s|s.role=="pier"||s.role=="mole")); }
            lengths.push(metres); counts.push(works.len());
            let layout:super::super::super::Layout=serde_json::from_value(serde_json::json!({
                "key":"scale","culture":"hanseatic","center":site.center,"quarters":[],"streets":streets,"blocks":[],"warnings":[]
            })).unwrap();
            let needs=super::super::super::roles::services_for_layout(&layout,pop,Default::default());
            building_need.push(needs.iter().filter(|n|n.entry.site=="quay").map(|n|n.area*n.sites as f64).sum::<f64>());
        }
        assert!(lengths[1]>lengths[0]*1.3);
        assert!(counts[1]>counts[0]);
        assert!(building_need[1]>building_need[0]*2.0);
    }

    #[test]
    fn ten_thousand_coastal_and_river_towns_have_built_connected_quays() {
        use super::super::super::{generate_quarters, generate_parcels, ParcelConfig};
        for (culture, river) in [("celtic-oppidum", false), ("dwarven", false), ("indian-temple", true), ("swahili-stone-town", true)] {
            let (n, width) = (if river { 96 } else { 192 }, 2800.0);
            let water: Vec<u8> = (0..n*n).map(|i| {
                let x = (i % n) as f64 * width / n as f64;
                let y = (i / n) as f64 * width / n as f64;
                let bank = 1700.0 + if river { 60.0 * (y / 250.0).sin() } else { 0.0 };
                if x >= bank && (!river || x < bank + 200.0) { if river { 3 } else { 1 } } else { 0 }
            }).collect();
            let height: Vec<f32> = (0..n*n).map(|i| 2.0 + if river { ((i / n) as f64 * width / n as f64 * 0.002) as f32 } else { 0.0 }).collect();
            let surface = Surface { geometry: None, width, n, height: &height, water: &water };
            let site = Site { key: "port-10k".into(), name: String::new(), population: 10_000, culture: culture.into(),
                center: Point { x: 1500.0, y: 1400.0 }, radius: 480.0 };
            let cfg = LayoutConfig { site_archetypes: std::collections::BTreeMap::from([("port-10k".into(), if river { "bridge" } else { "harbor" }.into())]), ..LayoutConfig::default() };
            let roads = [Street { path: vec![Point { x: 100.0, y: 1400.0 }, Point { x: 1690.0, y: 1400.0 }], widths: vec![7.0; 2], rank: 1, role: "regional".into() }];
            let layouts = generate_quarters("port-invariant", &[site], &cfg, surface, &roads).unwrap();
            let l = &layouts[0];
            let platforms = &l.structure.as_ref().unwrap().quays;
            let quays: Vec<_> = l.streets.iter().filter(|s| s.role == "quay").collect();
            eprintln!("{culture} river={river}: {} platforms, {} quay streets", platforms.len(), quays.len());
            assert!(!quays.is_empty(), "{culture}: missing quay street");
            assert!(platforms.iter().any(|q| q.kind == "quay" && q.shape.outer.iter().any(|&p| surface.wet(p))), "{culture}: embankment must touch water");
            for quay in &quays {
                assert!(quay.path.iter().any(|&p| l.streets.iter().filter(|s| s.role != "quay" && !matches!(s.role.as_str(), "pier" | "mole" | "landing"))
                    .any(|s| s.path.iter().any(|&q| dist(p, q) < 0.01))), "{culture}: quay disconnected from street graph");
            }
            if river {
                assert!(quays.iter().map(|q| length(&q.path)).sum::<f64>() > 250.0, "continuous river embankment");
                for q in platforms.iter().filter(|q| q.kind == "quay") {
                    for &p in q.shape.outer.iter().filter(|&&p| surface.wet(p)) {
                        assert!((q.deck_z_m - surface.height_at(p) - 1.0).abs() < 0.8, "{culture}: quay follows descending water");
                    }
                }
            } else {
                assert!(platforms.iter().filter(|q| q.kind == "pier").count() >= 2, "{culture}: multiple coastal piers");
            }
            for st in &l.streets {
                for w in st.path.windows(2) { for e in &l.enclosures { for edge in e.path.windows(2) {
                    if let Some((t, p)) = g::segment_hit(w[0], w[1], edge[0], edge[1]) {
                        if t > 0.01 && t < 0.99 { assert!(e.gates.iter().any(|&q| dist(p, q) < 8.0), "{culture}: street crosses closed wall"); }
                    }
                } } }
            }
            let parts = generate_parcels("port-invariant", &layouts, &ParcelConfig::default()).unwrap();
            let programme = parts[0].programme.as_ref().unwrap();
            let requests=super::super::super::building_sites::requests("port-invariant",&layouts,&parts,surface,&height,None).unwrap();
            for role in ["commerce.warehouse", "civic.harbour", "craft.boatshed", "commerce.fishmarket"] {
                assert!(programme.allocations.iter().any(|a| a.role == role), "{culture}: unplaced {role}");
                assert!(requests.iter().any(|r|programme.allocations.iter().any(|a|a.role==role && r["parcel_id"]==a.parcel_id)
                    && r["function"]!="open_space" && serde_json::from_value::<Vec<Shape>>(r["preview"].clone()).unwrap_or_default().iter().map(g::area).sum::<f64>()>20.0),
                    "{culture}: {role} needs a real building footprint and function");
            }
        }
    }

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
        cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
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
    /// Invariant: a port's quays front navigable water. Beside a 4 m brook
    /// (one raster cell) the bank stays a bank; beside a 24 m river the same
    /// port lines it with a quay.
    #[test]
    fn a_brook_is_banked_not_quayed() {
        let n = 64;
        let height = vec![1.0; n * n];
        let site = Site {
            key: "port".into(),
            name: String::new(),
            population: 2000,
            culture: "european-organic".into(),
            center: Point { x: 170.0, y: 128.0 },
            radius: 200.0,
        };
        let mut cfg = LayoutConfig::default();
        cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
        let road = Street {
            path: vec![Point { x: 175.0, y: 42.0 }, Point { x: 175.0, y: 214.0 }],
            widths: vec![5.0; 2],
            rank: 1,
            role: "street".into(),
        };
        let quayed = |x0: f64| {
            // River water (code 3) over x in [x0, 140).
            let water: Vec<u8> = (0..n * n)
                .map(|i| {
                    let x = ((i % n) as f64 + 0.5) * 4.0;
                    if x >= x0 && x < 140.0 { 3 } else { 0 }
                })
                .collect();
            let surface = Surface {
                geometry: None,
                width: 256.0,
                n,
                height: &height,
                water: &water,
            };
            let mut streets = vec![road.clone()];
            // The land east of the water, 30 m clear of the map edge.
            let region = g::rectangle(140.0, 40.0, 210.0, 216.0);
            quays(
                &[region],
                &mut streets,
                surface,
                &cfg,
                &site,
                "european-organic",
                true,
            );
            streets.iter().any(|s| s.role == "quay")
        };
        assert!(!quayed(136.0), "a quay along a 4 m brook");
        assert!(quayed(116.0), "no quay along a 24 m river");
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
        cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
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
                x: 470.0,
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

    /// A quay never stands where the land behind it climbs faster than a
    /// street over its 60 m: a ramp-then-cliff shore gets none, a gentle one does.
    #[test]
    fn a_quay_needs_gentle_land_behind_it() {
        let n = 64;
        let (_, water) = coast(n);
        let cfg = LayoutConfig::default();
        let shelf = |rise: f32| -> Vec<f32> {
            (0..n * n).map(|i| {
                let x = ((i % n) as f64 + 0.5) * 4.0 - 128.0;
                if x < 24.0 { 1.0 } else { 1.0 + rise * ((x - 24.0) / 12.0) as f32 }
            }).collect()
        };
        let at = |height: &[f32]| {
            let surface = Surface { geometry: None, width: 256.0, n, height, water: &water };
            gentle_behind(surface, Point { x: 130.0, y: 128.0 }, Point { x: 1.0, y: 0.0 }, 1.0, cfg.max_street_grade)
        };
        assert!(at(&shelf(0.5)));
        assert!(!at(&shelf(3.0)));
    }
}
