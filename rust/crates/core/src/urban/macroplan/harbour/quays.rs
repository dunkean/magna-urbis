//! Quay alignment and connections along usable shore runs.

use super::*;

pub(super) struct Piece {
    pub(super) path: Vec<Point>,
    pub(super) near: f64,
    pub(super) river: bool,
    /// Laid by an earlier pass, potentially before a town wall already standing behind it.
    pub(super) kept: bool,
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
pub(super) fn shore_runs(
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

/// The 60 m of land behind a quay point climbs at most `grade` per 12 m: the port yard stands on
/// it and the town reaches its quay by lanes, never down a cliff.
pub(super) fn gentle_behind(surface: Surface<'_>, p: Point, n: Point, side: f64, grade: f64) -> bool {
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
///
/// `town`: the pass that decides the harbour of the whole town (no wall is traced behind its quays
/// yet). It chooses one front among those laid so far and those it finds, reaches it over a longer way
/// where no street is near, and falls back, in a town of 3 000 people or more, on a beach landing (one
/// short quay under a steeper shore). Another pass keeps the quays it is given.
#[allow(clippy::too_many_arguments)]
pub(in super::super::super) fn quays(
    regions: &[Shape],
    streets: &mut Vec<Street>,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    site: &Site,
    culture: &str,
    town: bool,
) {
    lay_quays(regions, streets, surface, cfg, site, culture, town, cfg.max_lane_grade, f64::INFINITY);
    if town && site.population >= 3000 && port_town(cfg) && !streets.iter().any(|s| s.role == "quay") {
        lay_quays(regions, streets, surface, cfg, site, culture, town, BEACH_GRADE.max(cfg.max_lane_grade), BEACH_QUAY);
    }
}

/// Steepest shore (over 12 m) behind a beach landing: a footpath's grade.
const BEACH_GRADE: f64 = 0.35;
/// Length (m) of the quay of a beach landing.
const BEACH_QUAY: f64 = 80.0;

/// One pass of `quays`: the land behind a quay climbs at most `slope`, the quays it lays measure at
/// most `cap` metres.
#[allow(clippy::too_many_arguments)]
fn lay_quays(
    regions: &[Shape],
    streets: &mut Vec<Street>,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    site: &Site,
    culture: &str,
    town: bool,
    slope: f64,
    cap: f64,
) {
    const MIN: f64 = 20.0;
    let inherited: Vec<Street> = {
        let quays = streets.iter().filter(|s|s.role=="quay").cloned().collect();
        streets.retain(|s|s.role!="quay");
        quays
    };
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
    // Streets already along the shore (a town approach or a road on the
    // bank): a quay laid behind one would stand back in the town, its paving
    // spread across the road to the water. The quay is the waterfront or
    // nothing.
    let bank_streets: Vec<(Point, Point)> = streets
        .iter()
        .filter(|s| !matches!(s.role.as_str(), "quay" | "pier" | "landing" | "mole" | "boardwalk" | "bridge" | "ford" | "causeway"))
        .flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1])))
        .collect();
    let behind_street = |p: Point, n: Point| {
        let reach = probe + setback + 2.0;
        [1.0, -1.0].into_iter().any(|s: f64| {
            let side = Point { x: n.x * s, y: n.y * s };
            (1..=(2.0 * reach).ceil() as usize).map(|k| 0.5 * k as f64).find(|&d| surface.wet(add(p, side, d))).is_some_and(|d| {
                let water = add(p, side, d);
                bank_streets.iter().any(|&(c, e)| {
                    dist(super::super::point(c, e, 0.5), p) <= reach + 0.5 * dist(c, e) && g::segment_hit(p, water, c, e).is_some()
                })
            })
        })
    };
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
                        if channel_width(surface, &path) >= NAVIGABLE && !rock_side(surface, &path) {
                            pieces.push(Piece { path, near, river, kept: false });
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
                        && !served.along(super::super::point(a, b, 0.5), t, width * 0.5 + 1.0)
                        && [a, b, super::super::point(a, b, 0.5)].iter().all(|&p| {
                            !surface.wet(add(p, n, width * 0.5))
                                && !surface.wet(add(p, n, -width * 0.5))
                        })
                        && routing::segment_clear(surface, a, b, grade)
                        && g::segment_within(region, a, b)
                        && !behind_street(super::super::point(a, b, 0.5), n)
                        && [a, b].iter().all(|&p| {
                            // Not at a cliff foot: the land behind the quay
                            // rises no faster than a lane on either side.
                            [1.0, -1.0].iter().all(|&s| {
                                let q = add(p, n, s * 12.0);
                                surface.wet(q)
                                    || (surface.height_at(q) - surface.height_at(p)).abs()
                                        <= 12.0 * slope
                                        && gentle_behind(surface, p, n, s, slope)
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
    {
        pieces.extend(inherited.into_iter().filter(|s| channel_width(surface,&s.path) >= NAVIGABLE && !rock_side(surface,&s.path))
            .map(|s|Piece {near:s.path.iter().map(|&p|dist(p,site.center)).fold(f64::INFINITY,f64::min),river:river_side(surface,&s.path),path:s.path,kept:!town}));
        if !pieces.is_empty() && !h.fondamenta {
            let reach = Reach::new(surface, site.center, streets);
            pieces.retain(|p| reach.holds(p.path[p.path.len() / 2]));
        }
        if parameterized(cfg) { placement::select(&mut pieces,regions,streets,surface,site,cfg); }
    }
    let mut budget = quay_budget(site, cfg, h).min(cap) - streets
        .iter()
        .filter(|s| s.role == "quay")
        .map(|s| length(&s.path))
        .sum::<f64>();
    // A sea or lake harbour is one front: the best stretch (the quays of an earlier pass, else a
    // long one near the centre) is its seed, the others only extend it, the nearest first. A lagoon
    // town lines every shore, and river quays embank the town wherever it stands.
    let worth = |p: &Piece| p.near - 0.5 * length(&p.path).min(budget);
    let seed = pieces.iter().filter(|p| !p.river && !h.fondamenta)
        .min_by(|a, b| b.kept.cmp(&a.kept).then(worth(a).total_cmp(&worth(b))))
        .map(|p| p.path[p.path.len() / 2]);
    let rank = |p: &Piece| match seed {
        Some(c) if !p.river => p.path.iter().map(|&q| dist(q, c)).fold(f64::INFINITY, f64::min),
        _ => p.near,
    };
    pieces.sort_by(|a, b| a.river.cmp(&b.river).then(b.kept.cmp(&a.kept)).then(rank(a).total_cmp(&rank(b))));
    if std::env::var_os("URBAN_PROFILE").is_some() {eprintln!("harbour quay pieces={} rejected/turn/grade/domain/wet={rejected:?}",pieces.len());}
    // One simple quay line per shore, on the drawn waterline: a piece is cut
    // where it folds over itself, clipped where it runs within a quay width
    // of a quay already laid, and dropped where it does not front the water.
    let mut laid: Vec<Vec<Point>> = vec![];
    let mut harbour: Vec<Vec<Point>> = vec![];
    for piece in pieces {
        let open = !piece.river && !h.fondamenta;
        if open && !harbour.is_empty() && !piece.kept {
            let gap = piece.path.iter().flat_map(|&p| harbour.iter().flat_map(move |q| q.windows(2).map(move |w| g::distance(p, w[0], w[1]).0)))
                .fold(f64::INFINITY, f64::min);
            if gap > HARBOUR_REACH {
                continue;
            }
        }
        for mut path in unlaid(&untangled(piece.path), &laid, width + 1.0, MIN) {
            if budget < MIN {
                continue;
            }
            if touching(surface, &path, width * 0.5) < 0.7 {
                continue;
            }
            let l = length(&path);
            if l > budget {
                path = centred(&path, site.center, budget);
            }
            let Some(links) = landing_links(&mut path, streets, surface, cfg, slope, town) else {
                continue;
            };
            budget -= length(&path);
            if open {
                harbour.push(path.clone());
            }
            laid.push(path.clone());
            streets.push(Street {
                widths: vec![width; path.len()],
                path,
                rank: 1,
                role: "quay".into(),
            });
            streets.extend(links);
        }
    }
}



/// The land left between each quay and its water, as ribbons (path,
/// widths) to cut from the blocks with the street ribbons: the quay edge is
/// the waterline, no garden sliver lies beyond it. Each vertex reaches only
/// as far as the first water on the quay's water side (two raster cells plus
/// 20 m), so the
/// far bank of a canal is never touched.
pub(in super::super::super) fn seaward(
    streets: &[Street],
    surface: Surface<'_>,
) -> Vec<(Vec<Point>, Vec<f64>)> {
    let mut out = vec![];
    for q in streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
    {
        let half = q.widths.first().copied().unwrap_or(5.0) * 0.5;
        // Every 4 m: the quay edge follows the bank between the street's own
        // vertices (a straight quay street along a curved bank otherwise
        // overhangs the water at one end and stops short at the other).
        let line = densify(&q.path, 4.0);
        let k = line.len();
        let normal = |i: usize| {
            let (a, b) = (line[i.saturating_sub(1)], line[(i + 1).min(k - 1)]);
            left(unit(a, b))
        };
        // The drawn water (`Surface::wet`: the vector shoreline and banks the
        // renderer draws), not the raster cells: the quay edge is the drawn
        // waterline, neither short of it nor over the water.
        let first_wet = |p: Point, n: Point| {
            (1..=((surface.width / surface.n as f64 * 2.0 + 20.0) * 2.0).ceil() as usize)
                .map(|j| 0.5 * j as f64)
                .find(|&d| surface.wet(add(p, n, d)))
        };
        let m = k / 2;
        let side = [1.0, -1.0].into_iter().find(|&sg| {
            let n = normal(m);
            first_wet(
                line[m],
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
            let d = first_wet(line[i], n).unwrap_or(half) + 1.0;
            path.push(add(line[i], n, d * 0.5));
            widths.push(d);
        }
        out.push((path, widths));
    }
    out
}
