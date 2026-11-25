//! Optional informal growth, appended after every formal planning operation.
//! Its independent stream and retained prefix counts protect formal geometry,
//! cadastral IDs, service budgets and building heights when its scale changes.
use super::{geometry as g, *};
use crate::rng::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::f64::consts::TAU;

mod pockets;
use pockets::pocket;
mod buildings;
pub(super) use buildings::{allocate, request};
#[cfg(test)]
mod tests;

const MAX_CANDIDATES: usize = 192;
const MAX_POCKETS: usize = 6;
const MAX_HUTS: usize = 360;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extension {
    formal_quarters: usize,
    formal_blocks: usize,
    formal_streets: usize,
    formal_districts: usize,
    formal_allocated: usize,
    formal_metrics: UrbanMetrics,
    pub pockets: Vec<Pocket>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pocket {
    pub quarter: usize,
    pub block: usize,
    pub flavour: String,
    pub huts: Vec<Hut>,
    pub clearings: Vec<Shape>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hut {
    pub id: String,
    pub shape: Shape,
    pub axis: Point,
    pub front: [Point; 2],
    pub street: usize,
}
fn extension(layout: &Layout) -> Option<&Extension> {
    layout.structure.as_ref()?.shanty.as_ref()
}
/// The allocator sees exactly the plan it saw with this feature disabled.
pub(super) fn formal_layout(layout: &Layout) -> Cow<'_, Layout> {
    let Some(e) = extension(layout) else {
        return Cow::Borrowed(layout);
    };
    let mut formal = layout.clone();
    formal.quarters.truncate(e.formal_quarters);
    formal.blocks.truncate(e.formal_blocks);
    formal.streets.truncate(e.formal_streets);
    let structure = formal.structure.as_mut().unwrap();
    structure.districts.truncate(e.formal_districts);
    structure.allocated.truncate(e.formal_allocated);
    structure.metrics = e.formal_metrics.clone();
    structure.shanty = None;
    Cow::Owned(formal)
}
pub(super) fn formal_radius(layout: &Layout) -> f64 {
    let count = extension(layout).map_or(layout.quarters.len(), |e| e.formal_quarters);
    (layout.quarters[..count]
        .iter()
        .map(|q| g::area(&q.shape))
        .sum::<f64>()
        / std::f64::consts::PI)
        .sqrt()
        .max(1.)
}
fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn add(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + b.x * t,
        y: a.y + b.y * t,
    }
}
fn unit(a: Point) -> Point {
    let d = a.x.hypot(a.y).max(1e-9);
    Point {
        x: a.x / d,
        y: a.y / d,
    }
}
fn normal(a: Point) -> Point {
    Point { x: -a.y, y: a.x }
}
fn rectangle(c: Point, u: Point, w: f64, d: f64) -> Shape {
    Shape {
        outer: [
            (-w / 2., -d / 2.),
            (w / 2., -d / 2.),
            (w / 2., d / 2.),
            (-w / 2., d / 2.),
        ]
        .map(|(x, y)| add(add(c, u, x), normal(u), y))
        .to_vec(),
        holes: vec![],
    }
}
fn overlap(a: &Shape, b: &Shape) -> bool {
    let (x0, y0, x1, y1) = g::bbox(a);
    let (u0, v0, u1, v1) = g::bbox(b);
    x0 < u1
        && x1 > u0
        && y0 < v1
        && y1 > v0
        && g::intersection(a, b).iter().map(g::area).sum::<f64>() > 0.01
}
fn gradient(surface: Surface<'_>, p: Point) -> Point {
    Point {
        x: (surface.height_at(add(p, Point { x: 1., y: 0. }, 5.))
            - surface.height_at(add(p, Point { x: 1., y: 0. }, -5.)))
            / 10.,
        y: (surface.height_at(add(p, Point { x: 0., y: 1. }, 5.))
            - surface.height_at(add(p, Point { x: 0., y: 1. }, -5.)))
            / 10.,
    }
}
fn nearest_water(surface: Surface<'_>, p: Point) -> Option<(f64, Point)> {
    // Constant work even on a large terrain; do not scan the terrain raster.
    for r in [12., 24., 40., 60., 85., 115.] {
        for k in 0..24 {
            let a = k as f64 * TAU / 24.;
            let q = add(
                p,
                Point {
                    x: a.cos(),
                    y: a.sin(),
                },
                r,
            );
            if q.x > 0. && q.y > 0. && q.x < surface.width && q.y < surface.width && surface.wet(q)
            {
                return Some((r, q));
            }
        }
    }
    None
}
fn road_targets(p: Point, streets: &[Street]) -> Vec<(f64, Point, Point)> {
    let mut targets = streets
        .iter()
        .filter(|s| !matches!(s.role.as_str(), "bridge" | "pier" | "mole" | "stairs"))
        .flat_map(|s| s.path.windows(2))
        .map(|ab| {
            let (d, _, q) = g::distance(p, ab[0], ab[1]);
            (
                d,
                q,
                unit(Point {
                    x: ab[1].x - ab[0].x,
                    y: ab[1].y - ab[0].y,
                }),
            )
        })
        .collect::<Vec<_>>();
    targets.sort_by(|a, b| a.0.total_cmp(&b.0));
    targets.truncate(10);
    targets
}
fn dry_shape(surface: Surface<'_>, shape: &Shape, grade: f64) -> bool {
    let c = g::centroid(shape);
    !surface.wet(c)
        && shape.outer.iter().enumerate().all(|(i, &a)| {
            super::routing::segment_clear(
                surface,
                a,
                shape.outer[(i + 1) % shape.outer.len()],
                grade,
            ) && super::routing::segment_clear(surface, a, c, grade)
        })
}
fn grade_path(surface: Surface<'_>, path: &[Point], grade: f64) -> bool {
    path.windows(2)
        .all(|ab| super::routing::segment_clear(surface, ab[0], ab[1], grade))
}

fn remaining_households(pr: &UrbanProgramme) -> usize {
    let wanted: f64 = pr
        .demands
        .iter()
        .filter(|d| d.unit == "domesticUnits")
        .map(|d| d.requested)
        .sum();
    let cap = (wanted * 1.3).floor().max(wanted.ceil());
    let held: f64 = pr.allocations.iter().map(|a| a.households).sum();
    (cap - held).max(0.).floor() as usize
}

/// Remove empty terminal runs, stopping at occupied frontage or a junction.
/// Work before publishing street indices so hut access can be remapped once.
fn prune_paths(
    local: &mut Vec<Street>,
    streets: &[Street],
    huts: &mut [Hut],
    clearings: &[Shape],
    first_street: usize,
) {
    loop {
        let mut changed = false;
        for i in 0..local.len() {
            for start in [false, true] {
                let s = &local[i];
                let n = s.path.len();
                if n < 2 {
                    continue;
                }
                let (end, inner) = if start { (0, 1) } else { (n - 1, n - 2) };
                let (a, b) = (s.path[inner], s.path[end]);
                let reach = s.widths.iter().copied().fold(0., f64::max) * 0.5 + 3.5;
                // Frontage lanes end at built lots; footpaths may also end at a court.
                let serves = huts
                    .iter()
                    .map(|h| &h.shape)
                    .chain(clearings.iter().filter(|_| s.role == "path"))
                    .any(|shape| {
                        g::contains(shape, b)
                            || shape
                                .outer
                                .iter()
                                .zip(shape.outer.iter().cycle().skip(1))
                                .any(|(&p, &q)| {
                                    g::segment_hit(a, b, p, q).is_some()
                                        || g::distance(p, a, b).0 <= reach
                                        || g::distance(q, a, b).0 <= reach
                                        || g::distance(a, p, q).0 <= reach
                                        || g::distance(b, p, q).0 <= reach
                                })
                    });
                let others = || {
                    streets.iter().chain(
                        local
                            .iter()
                            .enumerate()
                            .filter(|&(j, _)| j != i)
                            .map(|(_, s)| s),
                    )
                };
                let connected = others().any(|t| {
                    t.path.windows(2).any(|w| {
                        g::distance(b, w[0], w[1]).0
                            <= t.widths.first().copied().unwrap_or(4.) * 0.5 + 1.5
                    })
                });
                if serves || connected {
                    continue;
                }
                // A junction may lie inside the segment being shortened.
                // Preserve it instead of dropping the whole segment and its branches.
                let junction = others()
                    .flat_map(|t| t.path.windows(2))
                    .flat_map(|w| {
                        let mut hits = Vec::with_capacity(3);
                        if let Some(hit) = g::segment_hit(a, b, w[0], w[1]) {
                            hits.push(hit);
                        }
                        for &p in w {
                            let (d, t, q) = g::distance(p, a, b);
                            if d <= 0.75 {
                                hits.push((t, q));
                            }
                        }
                        hits
                    })
                    .filter(|&(t, _)| t > 1e-7 && t < 1. - 1e-7)
                    .max_by(|a, b| a.0.total_cmp(&b.0));
                if let Some((_, p)) = junction {
                    local[i].path[end] = p;
                } else {
                    local[i].path.remove(end);
                }
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut remap = vec![None; local.len()];
    let mut kept = Vec::with_capacity(local.len());
    for (i, s) in local.drain(..).enumerate() {
        if s.path.len() >= 2 {
            remap[i] = Some(first_street + kept.len());
            kept.push(s);
        }
    }
    for hut in huts {
        hut.street = remap[hut.street - first_street].expect("occupied shanty access retained");
    }
    *local = kept;
}
struct Candidate {
    point: Point,
    axis: Point,
    score: f64,
    salt: usize,
}

pub(super) fn extend(
    seed: &str,
    layout: &mut Layout,
    site: &Site,
    cfg: &LayoutConfig,
    kind: kinds::Kind,
    surface: Surface<'_>,
    roads: &[Street],
) {
    if cfg.shanty_scale <= 0.
        || site.population < 5000
        || cfg.scope != "settlement"
        || cfg.programme.intent != "settlement"
        || !matches!(
            kind,
            kinds::Kind::MarketTown
                | kinds::Kind::WalledTown
                | kinds::Kind::City
                | kinds::Kind::Metropolis
        )
        || matches!(cfg.programme.state.as_str(), "abandoned" | "ruined")
        || extension(layout).is_some()
    {
        return;
    }
    let Some(flavour) = catalogue()["cultures"][&layout.culture]["shanty"].as_str() else {
        return;
    };
    let data = &catalogue()["shanty"][flavour];
    if data.is_null() {
        return;
    }
    let siting = data["siting"].as_str().unwrap_or(flavour);
    // Measure the final formal allocation before adding any pocket geometry.
    // Informal households fit under the same cap, including its frontage surplus.
    let Ok(parts) =
        super::generate_parcels(seed, std::slice::from_ref(layout), &ParcelConfig::default())
    else {
        return;
    };
    let budget = parts
        .first()
        .and_then(|p| p.programme.as_ref())
        .map_or(0, remaining_households)
        .min(MAX_HUTS);
    if budget < 6 {
        return;
    }
    let key_seed = format!("{seed}\u{1}settlement:{}", layout.key);
    let rng = Rng::new(&format!("{key_seed}\u{1}shanty-v2"));
    let mut e = Extension {
        formal_quarters: layout.quarters.len(),
        formal_blocks: layout.blocks.len(),
        formal_streets: layout.streets.len(),
        formal_districts: layout.structure.as_ref().map_or(0, |s| s.districts.len()),
        formal_allocated: layout.structure.as_ref().map_or(0, |s| s.allocated.len()),
        formal_metrics: layout
            .structure
            .as_ref()
            .map_or_else(UrbanMetrics::default, |s| s.metrics.clone()),
        pockets: vec![],
    };
    // Outer formal quarters, their 20 m breathing space, water works and walls
    // remain exclusions. Pocket outlines are clipped against these exact shapes.
    let mut forbidden = layout
        .quarters
        .iter()
        .map(|q| q.shape.clone())
        .collect::<Vec<_>>();
    // Breathing-space ribbons are pure per quarter: built in parallel, kept in order.
    let breathing = super::par::map(&layout.quarters, |_, q| {
        let mut ring = q.shape.outer.clone();
        if let Some(p) = ring.first().copied() {
            ring.push(p);
        }
        // A 40 m band needs no metre detail: an outline clipped to the built
        // land carries hundreds of short edges, and the band of each costs.
        g::ribbon(&g::simplify(&ring, 4.0, |_| false), &[40.])
    });
    forbidden.extend(breathing.into_iter().flatten());
    forbidden.extend(
        layout
            .enclosures
            .iter()
            .flat_map(|e| e.reserve.iter().cloned()),
    );
    forbidden.extend(
        layout
            .structure
            .iter()
            .flat_map(|s| s.quays.iter().map(|q| q.shape.clone())),
    );
    forbidden.extend(
        layout
            .structure
            .iter()
            .flat_map(|s| s.spring_sites.iter().map(|q| q.shape.clone())),
    );
    // Neighbouring towns' land and its margin (none without neighbours).
    forbidden.extend(super::neighbours::forbidden(site));
    let streets = layout
        .streets
        .iter()
        .chain(roads)
        .cloned()
        .collect::<Vec<_>>();
    let road_masks = super::par::map(&streets, |_, s| g::ribbon(&s.path, &s.widths))
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let mut obstacles = layout
        .blocks
        .iter()
        .map(|b| b.shape.clone())
        .chain(
            layout
                .enclosures
                .iter()
                .flat_map(|e| e.reserve.iter().cloned()),
        )
        .collect::<Vec<_>>();
    let boundary = layout
        .quarters
        .iter()
        .flat_map(|q| {
            q.shape
                .outer
                .iter()
                .enumerate()
                .map(move |(i, &a)| (a, q.shape.outer[(i + 1) % q.shape.outer.len()]))
        })
        .collect::<Vec<_>>();
    if boundary.is_empty() {
        return;
    }
    let mut candidates = vec![];
    for salt in 0..MAX_CANDIDATES {
        let mut r = rng.fork(&format!("site:{salt}"));
        let (a, b) = boundary[(r.float() * boundary.len() as f64) as usize];
        let tangent = unit(Point {
            x: b.x - a.x,
            y: b.y - a.y,
        });
        let outward = Point {
            x: tangent.y,
            y: -tangent.x,
        };
        let p = add(
            add(
                a,
                Point {
                    x: b.x - a.x,
                    y: b.y - a.y,
                },
                r.range(0.15, 0.85),
            ),
            outward,
            r.range(48., 180.),
        );
        if surface.wet(p) || forbidden.iter().any(|s| g::contains(s, p)) {
            continue;
        }
        let grad = gradient(surface, p);
        let slope = grad.x.hypot(grad.y);
        let targets = road_targets(p, &streets);
        let Some(&(road_distance, _, road_axis)) = targets.first() else {
            continue;
        };
        if road_distance > 210. {
            continue;
        }
        let (axis, suitability) = match siting {
            "riverbank" => {
                let Some((d, water)) = nearest_water(surface, p) else {
                    continue;
                };
                // Low bank land, not a cliff above the channel.
                if slope > 0.15 || surface.height_at(p) - surface.height_at(water) > 9. {
                    continue;
                }
                (
                    normal(unit(Point {
                        x: water.x - p.x,
                        y: water.y - p.y,
                    })),
                    2. - d / 100. - slope * 3.,
                )
            }
            "gecekondu" => {
                if !(0.045..=0.55).contains(&slope) {
                    continue;
                }
                (normal(unit(grad)), 1.5 - (slope - 0.18).abs() * 3.)
            }
            "bidonville" => {
                if slope > 0.14 {
                    continue;
                }
                (road_axis, 1. - slope * 5.)
            }
            _ => continue,
        };
        let industry = layout
            .structure
            .iter()
            .flat_map(|s| &s.districts)
            .filter(|d| d.role.starts_with("craft:"))
            .flat_map(|d| &d.quarters)
            .filter_map(|&q| layout.quarters.get(q))
            .map(|q| distance(p, g::centroid(&q.shape)))
            .fold(f64::INFINITY, f64::min);
        let gate = layout
            .enclosures
            .iter()
            .flat_map(|e| &e.gates)
            .map(|&g| distance(p, g))
            .fold(f64::INFINITY, f64::min);
        candidates.push(Candidate {
            point: p,
            axis,
            score: suitability - road_distance / 140.
                + (1. - industry / 240.).max(0.) * 0.35
                + (1. - gate / 200.).max(0.) * 0.3
                + r.range(0., 0.55),
            salt,
        });
    }
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.salt.cmp(&b.salt)));
    let wanted = ((2. + (site.population as f64 / 15000.).sqrt()) * cfg.shanty_scale)
        .ceil()
        .clamp(1., MAX_POCKETS as f64) as usize;
    let mut total_huts = 0;
    for candidate in candidates {
        if e.pockets.len() >= wanted || budget - total_huts < 6 {
            break;
        }
        if e.pockets.iter().any(|p| {
            distance(
                candidate.point,
                g::centroid(&layout.quarters[p.quarter].shape),
            ) < 105.
        }) {
            continue;
        }
        let mut r = rng.fork(&format!("pocket:{}", candidate.salt));
        if let Some(pocket) = pocket(
            layout,
            candidate,
            flavour,
            cfg,
            surface,
            &streets,
            &forbidden,
            &road_masks,
            &obstacles,
            &mut r,
            budget - total_huts,
        ) {
            total_huts += pocket.huts.len();
            obstacles.extend(pocket.huts.iter().map(|h| h.shape.clone()));
            forbidden.push(layout.quarters[pocket.quarter].shape.clone());
            e.pockets.push(pocket);
        }
    }
    if !e.pockets.is_empty() {
        let structure = layout.structure.get_or_insert_with(UrbanStructure::default);
        for p in &e.pockets {
            let shape = layout.quarters[p.quarter].shape.clone();
            structure.metrics.allocated_area += g::area(&shape);
            structure.metrics.components += 1;
            structure.allocated.push(shape);
        }
        structure.shanty = Some(e);
    }
}
