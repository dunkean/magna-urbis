//! Optional informal growth, appended after every formal planning operation.
//! Its independent stream and retained prefix counts protect formal geometry,
//! cadastral IDs, service budgets and building heights when its scale changes.
use super::{geometry as g, *};
use std::borrow::Cow;
use std::f64::consts::TAU;

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
    for q in &layout.quarters {
        let mut ring = q.shape.outer.clone();
        if let Some(p) = ring.first().copied() {
            ring.push(p);
        }
        forbidden.extend(g::ribbon(&ring, &[40.]));
    }
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
    let streets = layout
        .streets
        .iter()
        .chain(roads)
        .cloned()
        .collect::<Vec<_>>();
    let road_masks = streets
        .iter()
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
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

#[allow(clippy::too_many_arguments)]
fn pocket(
    layout: &mut Layout,
    candidate: Candidate,
    flavour: &str,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    streets: &[Street],
    forbidden: &[Shape],
    road_masks: &[Shape],
    obstacles: &[Shape],
    rng: &mut Rng,
    budget: usize,
) -> Option<Pocket> {
    let Candidate {
        point: c, axis: u, ..
    } = candidate;
    let v = normal(u);
    let length = rng.range(30., 68.) * cfg.shanty_scale.sqrt().clamp(0.65, 1.35);
    let depth = rng.range(17., 37.);
    let phase = rng.range(0., TAU);
    let outline = g::normalized(Shape {
        outer: (0..32)
            .map(|i| {
                let a = i as f64 * TAU / 32.;
                let wobble = 1. + 0.14 * (3. * a + phase).sin() + 0.08 * (5. * a - phase).cos();
                add(
                    add(c, u, length * a.cos() * wobble),
                    v,
                    depth * a.sin() * wobble,
                )
            })
            .collect(),
        holes: vec![],
    });
    let mut pieces = g::dry_clip(&surface, &outline);
    for mask in forbidden {
        if pieces.iter().any(|s| overlap(s, mask)) {
            pieces = pieces.iter().flat_map(|s| g::difference(s, mask)).collect();
        }
    }
    let shape = pieces
        .into_iter()
        .filter(|s| g::area(s) > 900.)
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    let c = g::interior_point(&shape);
    let grade = if flavour == "gecekondu" && cfg.allow_stairs {
        cfg.max_stair_grade
    } else {
        cfg.max_lane_grade
    };
    let mut lane = (-3..=3)
        .map(|i| {
            add(
                add(c, u, i as f64 * length / 3.5),
                v,
                (i as f64 * 0.9 + phase).sin() * depth * 0.14,
            )
        })
        .collect::<Vec<_>>();
    // Keep the connected middle run if a shore/quarter cut bites an end.
    while lane.len() > 2 && !g::contains(&shape, lane[0]) {
        lane.remove(0);
    }
    while lane.len() > 2 && !g::contains(&shape, *lane.last().unwrap()) {
        lane.pop();
    }
    if !lane.iter().all(|&p| g::contains(&shape, p))
        || !lane
            .windows(2)
            .all(|ab| g::segment_within(&shape, ab[0], ab[1]))
        || !grade_path(surface, &lane, cfg.max_lane_grade)
    {
        return None;
    }
    let targets = road_targets(lane[0], streets);
    let mut entrance = None;
    for (_, goal, _) in targets {
        let start = lane[0];
        if distance(start, goal) > 230. {
            continue;
        }
        let path = vec![
            goal,
            Point {
                x: (goal.x + start.x) / 2.,
                y: (goal.y + start.y) / 2.,
            },
            start,
        ];
        if !grade_path(surface, &path, grade) {
            continue;
        }
        let corridor = g::ribbon(&path, &[2.4]);
        if corridor
            .iter()
            .any(|s| obstacles.iter().any(|b| overlap(s, b)))
        {
            continue;
        }
        entrance = Some(path);
        break;
    }
    let entrance = entrance?;
    let first_street = layout.streets.len();
    let mut local = vec![
        Street {
            path: entrance,
            widths: vec![2.4],
            rank: 3,
            role: "path".into(),
        },
        Street {
            path: lane.clone(),
            widths: vec![rng.range(3.0, 4.3)],
            rank: 3,
            role: "lane".into(),
        },
    ];
    // A small unbuilt court at the fork; no ornamental gardens in this tissue.
    let clearing = rectangle(
        lane[lane.len() / 2],
        u,
        rng.range(7., 10.),
        rng.range(6., 9.),
    );
    let clearings = if clearing.outer.iter().all(|&p| g::contains(&shape, p)) {
        vec![clearing]
    } else {
        vec![]
    };
    let mut huts: Vec<Hut> = vec![];
    let mut occupied: Vec<Shape> = vec![];
    let mut path_masks = local
        .iter()
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
        .collect::<Vec<_>>();
    // Short branching closes form small compounds instead of Voronoi confetti.
    // On slopes these closes climb between the contour-aligned dirt lanes.
    let closes = rng.int(6, 11) as usize;
    for k in 0..closes {
        let x = -length * 0.78
            + k as f64 * length * 1.56 / (closes - 1) as f64
            + rng.range(-length * 0.07, length * 0.07);
        let root = lane
            .windows(2)
            .map(|ab| {
                let target = add(c, u, x);
                let (d, _, p) = g::distance(target, ab[0], ab[1]);
                (d, p)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))?
            .1;
        for side in [-1., 1.] {
            if rng.chance(0.12) {
                continue;
            }
            let end = add(
                add(root, v, side * depth * rng.range(0.65, 0.92)),
                u,
                rng.range(-4., 4.),
            );
            if !g::contains(&shape, end)
                || !g::segment_within(&shape, root, end)
                || !super::routing::segment_clear(surface, root, end, grade)
            {
                continue;
            }
            let middle = add(
                Point {
                    x: (root.x + end.x) * 0.5,
                    y: (root.y + end.y) * 0.5,
                },
                u,
                rng.range(-1.4, 1.4),
            );
            let branch = Street {
                path: vec![root, middle, end],
                widths: vec![1.1],
                rank: 4,
                role: "path".into(),
            };
            if !branch
                .path
                .windows(2)
                .all(|ab| g::segment_within(&shape, ab[0], ab[1]))
                || !grade_path(surface, &branch.path, grade)
            {
                continue;
            }
            let branch_masks = g::ribbon(&branch.path, &branch.widths);
            if occupied
                .iter()
                .any(|s| branch_masks.iter().any(|p| overlap(s, p)))
            {
                continue;
            }
            let street = first_street + local.len();
            let mask_count = path_masks.len();
            let hut_count = huts.len();
            path_masks.extend(branch_masks);
            local.push(branch);
            let along = unit(Point {
                x: end.x - root.x,
                y: end.y - root.y,
            });
            let across = normal(along);
            let mut station = rng.range(5.0, 6.0);
            for step in 0..4 {
                if step > 0 {
                    station += rng.range(6.2, 8.4);
                }
                if station > distance(root, end) - 1. {
                    break;
                }
                for flank in [-1., 1.] {
                    if huts.len() >= budget.min(90) {
                        break;
                    }
                    let p = add(
                        add(root, along, station),
                        across,
                        flank * rng.range(3.0, 4.0),
                    );
                    let edge = forbidden
                        .iter()
                        .filter(|s| g::area(s) > 100.)
                        .flat_map(|s| {
                            s.outer
                                .iter()
                                .zip(s.outer.iter().cycle().skip(1))
                                .take(s.outer.len())
                        })
                        .map(|(&a, &b)| g::distance(p, a, b).0)
                        .fold(200., f64::min);
                    let density = (0.94 - edge / 330. - station / 120.).clamp(0.35, 0.93);
                    if !rng.chance(density) {
                        continue;
                    }
                    let w = rng.range(3.2, 6.6);
                    let d = rng.range(3.7, 6.7);
                    let theta = rng.range(-0.23, 0.23);
                    let axis = Point {
                        x: across.x * theta.cos() - across.y * theta.sin(),
                        y: across.x * theta.sin() + across.y * theta.cos(),
                    };
                    let hut = rectangle(p, axis, w, d);
                    let pad = rectangle(p, axis, w + 0.7, d + 0.7);
                    if !hut.outer.iter().all(|&p| g::contains(&shape, p))
                        || !hut
                            .outer
                            .iter()
                            .enumerate()
                            .all(|(i, &a)| g::segment_within(&shape, a, hut.outer[(i + 1) % 4]))
                        || !dry_shape(surface, &hut, 0.65)
                        || path_masks
                            .iter()
                            .chain(road_masks)
                            .chain(&clearings)
                            .chain(&occupied)
                            .any(|s| overlap(&pad, s))
                    {
                        continue;
                    }
                    let front = if flank > 0. {
                        [hut.outer[3], hut.outer[0]]
                    } else {
                        [hut.outer[1], hut.outer[2]]
                    };
                    let id = format!(
                        "{}/shanty/{}/hut/{}",
                        layout.key,
                        layout.quarters.len(),
                        huts.len()
                    );
                    occupied.push(pad);
                    huts.push(Hut {
                        id,
                        shape: hut,
                        axis,
                        front,
                        street,
                    });
                }
            }
            if hut_count == huts.len() {
                local.pop();
                path_masks.truncate(mask_count);
            }
        }
    }
    // Compact infill grows off the closes. Staggered, jittered stations leave
    // narrow shared passages, while short spurs reach the remaining compounds.
    // The initial closes alone would leave large empty lawns between sheds.
    let columns = (2. * length / 5.9).ceil() as usize;
    let rows = (2. * depth / 6.2).ceil() as usize;
    let inward = unit(Point {
        x: layout.center.x - c.x,
        y: layout.center.y - c.y,
    });
    for row in 0..rows.min(16) {
        for column in 0..columns.min(36) {
            if huts.len() >= budget.min(90) {
                break;
            }
            let x = -length
                + (column as f64 + 0.5) * 5.9
                + (row % 2) as f64 * 2.6
                + rng.range(-0.65, 0.65);
            let y = -depth + (row as f64 + 0.5) * 6.2 + rng.range(-0.65, 0.65);
            let p = add(add(c, u, x), v, y);
            if !g::contains(&shape, p) {
                continue;
            }
            let nearest = local
                .iter()
                .enumerate()
                .flat_map(|(i, s)| {
                    s.path.windows(2).map(move |ab| {
                        let (d, _, goal) = g::distance(p, ab[0], ab[1]);
                        (d, goal, i)
                    })
                })
                .min_by(|a, b| a.0.total_cmp(&b.0));
            let Some((gap, goal, way)) = nearest else {
                continue;
            };
            if gap > 16. {
                continue;
            }
            let outward = -((p.x - c.x) * inward.x + (p.y - c.y) * inward.y) / length.max(depth);
            let density = (0.97 - gap / 90. - (y / depth).powi(2) * 0.2 - outward.max(0.) * 0.25)
                .clamp(0.5, 0.94);
            if !rng.chance(density) {
                continue;
            }
            let angle = rng.range(-0.16, 0.16);
            let axis = Point {
                x: u.x * angle.cos() - u.y * angle.sin(),
                y: u.x * angle.sin() + u.y * angle.cos(),
            };
            let w = rng.range(3.4, 5.4);
            let d = rng.range(3.9, 5.8);
            let hut = rectangle(p, axis, w, d);
            let pad = rectangle(p, axis, w + 0.45, d + 0.45);
            if !hut.outer.iter().enumerate().all(|(i, &a)| {
                g::contains(&shape, a) && g::segment_within(&shape, a, hut.outer[(i + 1) % 4])
            }) || !dry_shape(surface, &hut, 0.65)
                || path_masks
                    .iter()
                    .chain(road_masks)
                    .chain(&clearings)
                    .chain(&occupied)
                    .any(|s| overlap(&pad, s))
            {
                continue;
            }
            let front = (0..4)
                .map(|i| [hut.outer[i], hut.outer[(i + 1) % 4]])
                .min_by(|a, b| {
                    let middle = |e: &[Point; 2]| Point {
                        x: (e[0].x + e[1].x) * 0.5,
                        y: (e[0].y + e[1].y) * 0.5,
                    };
                    distance(middle(a), goal).total_cmp(&distance(middle(b), goal))
                })
                .unwrap();
            let door = Point {
                x: (front[0].x + front[1].x) * 0.5,
                y: (front[0].y + front[1].y) * 0.5,
            };
            if !g::segment_within(&shape, goal, door)
                || !super::routing::segment_clear(surface, goal, door, grade)
            {
                continue;
            }
            let spur = Street {
                path: vec![goal, door],
                widths: vec![0.85],
                rank: 4,
                role: "path".into(),
            };
            let corridor = g::ribbon(&spur.path, &spur.widths);
            if corridor
                .iter()
                .any(|s| occupied.iter().any(|h| overlap(s, h)))
            {
                continue;
            }
            let street = if distance(goal, door) > 0.7 {
                let street = first_street + local.len();
                path_masks.extend(corridor);
                local.push(spur);
                street
            } else {
                first_street + way
            };
            let id = format!(
                "{}/shanty/{}/hut/{}",
                layout.key,
                layout.quarters.len(),
                huts.len()
            );
            occupied.push(pad);
            huts.push(Hut {
                id,
                shape: hut,
                axis,
                front,
                street,
            });
        }
    }
    if huts.len() < 6 {
        return None;
    }
    prune_paths(&mut local, streets, &mut huts, &clearings, first_street);
    let quarter = layout.quarters.len();
    let block = layout.blocks.len();
    let phase = layout.quarters.first().map_or(0, |q| q.phase);
    layout.quarters.push(Quarter {
        shape: shape.clone(),
        phase,
        zone: "shanty".into(),
    });
    layout.blocks.push(Block {
        shape,
        quarter,
        kind: "shanty".into(),
        axis: u,
        zone: "shanty".into(),
        phase: Some(phase),
    });
    layout.streets.extend(local);
    let structure = layout.structure.get_or_insert_with(UrbanStructure::default);
    let id = structure.districts.len();
    structure.districts.push(UrbanDistrict {
        id,
        center: 0,
        phase,
        tissue: "organic".into(),
        quarters: vec![quarter],
        role: "shanty".into(),
        wealth: 0.08,
        label: catalogue()["shanty"][flavour]["label"]
            .as_str()
            .unwrap_or("Habitat informel")
            .into(),
    });
    Some(Pocket {
        quarter,
        block,
        flavour: flavour.into(),
        huts,
        clearings,
    })
}

/// Append fixed small footprints after service allocation/consolidation. Their
/// households were capped by the remaining formal population budget at siting.
pub(super) fn allocate(layout: &Layout, partition: &mut Partition) {
    let Some(e) = extension(layout) else { return };
    let Some(pr) = partition.programme.as_mut() else {
        return;
    };
    // Reallocation or a parcel override can leave less room than the default
    // cadastre used for siting. Those fixed footprints become open patches.
    let mut remaining = remaining_households(pr);
    if !pr.cultures.iter().any(|c| c.culture == layout.culture) {
        let Some(c) = culture::mapping_for(&layout.culture, &pr.context.period) else {
            return;
        };
        pr.cultures.push(c);
    }
    let pack = pr
        .cultures
        .iter()
        .find(|c| c.culture == layout.culture)
        .unwrap()
        .architecture_pack
        .clone();
    let demand_id = format!("{}/informal-housing", layout.key);
    if !pr.demands.iter().any(|d| d.id == demand_id) {
        let households = e
            .pockets
            .iter()
            .map(|p| p.huts.len())
            .sum::<usize>()
            .min(remaining) as f64;
        pr.demands.push(programme::Demand {
            id: demand_id.clone(),
            function: "domestic".into(),
            unit: "households".into(),
            requested: households,
            target_area: e
                .pockets
                .iter()
                .flat_map(|p| &p.huts)
                .map(|h| g::area(&h.shape))
                .sum(),
            target_frontage: 0.,
            provenance: vec!["informal-growth".into()],
            requires: vec![],
            parcel_capacity: households,
            built_capacity: 0.,
            open_capacity: 0.,
            deficit: households,
            reasons: vec!["Informal housing within the town population budget".into()],
            role: "dwelling.shanty".into(),
            sites: households as usize,
            site: "periphery".into(),
            landmark: false,
            district: "shanty".into(),
            placement: "parcel".into(),
        });
    }
    for p in &e.pockets {
        for hut in &p.huts {
            if partition.parcels.iter().any(|p| p.id == hut.id) {
                continue;
            }
            let housed = remaining > 0;
            remaining = remaining.saturating_sub(1);
            partition.parcels.push(Parcel {
                id: hut.id.clone(),
                shape: hut.shape.clone(),
                block: p.block,
                pressure: 0.8,
                envelope: housed.then(|| hut.shape.clone()),
                parent_ids: vec![],
                provenance: vec!["informal-growth".into()],
                family: if housed { "shanty" } else { "public" }.into(),
                reason: if housed {
                    p.flavour.clone()
                } else {
                    "population-budget-open-patch".into()
                },
                contacts: vec![],
                use_kind: if housed { "plot" } else { "place" }.into(),
                front: Some(hut.front),
                axis: hut.axis,
                rank: 4,
                access: Some(ParcelAccess {
                    kind: "public".into(),
                    street: Some(hut.street),
                    front_length: distance(hut.front[0], hut.front[1]),
                }),
            });
            if !housed {
                continue;
            }
            pr.allocations.push(programme::Allocation {
                parcel_id: hut.id.clone(),
                demand_id: demand_id.clone(),
                function: "domestic".into(),
                culture: layout.culture.clone(),
                architecture_pack: pack.clone(),
                capacity: 1.,
                unit: "households".into(),
                score: 1.,
                reasons: vec!["Informal housing within the town population budget".into()],
                role: "dwelling.shanty".into(),
                label: "Habitation informelle".into(),
                landmark: false,
                households: 1.,
                housing_floor_need: None,
                district_role: "shanty".into(),
                wealth: 0.08,
            });
        }
        for (i, shape) in p.clearings.iter().enumerate() {
            let id = format!("{}/shanty/{}/court/{i}", layout.key, p.quarter);
            if partition.parcels.iter().any(|p| p.id == id) {
                continue;
            }
            partition.parcels.push(Parcel {
                id,
                shape: shape.clone(),
                block: p.block,
                pressure: 0.,
                envelope: None,
                parent_ids: vec![],
                provenance: vec!["informal-growth".into()],
                family: "public".into(),
                reason: "well-and-market-court".into(),
                contacts: vec![],
                use_kind: "place".into(),
                front: None,
                axis: Point { x: 1., y: 0. },
                rank: 4,
                access: None,
            });
        }
    }
}

/// Reuse the common preview/massing contract, with small cultural salvage roofs.
/// Separate roof pieces give visible patches in every existing 2D/3D painter.
pub(super) fn request(
    layout: &Layout,
    parcel: &Parcel,
    surface: Surface<'_>,
    seed: &str,
) -> Result<Value, String> {
    let e = extension(layout).ok_or("Missing informal quarter")?;
    let pocket = e
        .pockets
        .iter()
        .find(|p| p.block == parcel.block)
        .ok_or("Missing informal pocket")?;
    let hut = pocket
        .huts
        .iter()
        .find(|h| h.id == parcel.id)
        .ok_or("Missing informal hut")?;
    let data = &catalogue()["shanty"][&pocket.flavour];
    let mut rng = Rng::new(seed);
    let covers = data["covers"]
        .as_array()
        .ok_or("Missing informal roof materials")?;
    let walls = data["walls"]
        .as_array()
        .ok_or("Missing informal wall materials")?;
    let wall = walls[rng.int(0, walls.len() as u32 - 1) as usize]
        .as_str()
        .unwrap_or("wood");
    let c = g::centroid(&hut.shape);
    let mut shapes = vec![hut.shape.clone()];
    if rng.chance(0.6) {
        let a = &hut.shape.outer;
        let t = rng.range(0.38, 0.72);
        let p = add(
            a[0],
            Point {
                x: a[1].x - a[0].x,
                y: a[1].y - a[0].y,
            },
            t,
        );
        let q = add(
            a[3],
            Point {
                x: a[2].x - a[3].x,
                y: a[2].y - a[3].y,
            },
            t,
        );
        shapes = vec![
            Shape {
                outer: vec![a[0], p, q, a[3]],
                holes: vec![],
            },
            Shape {
                outer: vec![p, a[1], a[2], q],
                holes: vec![],
            },
        ];
    }
    let parts = shapes
        .iter()
        .cloned()
        .map(|s| (s, "building"))
        .collect::<Vec<_>>();
    let arch =
        json!({"roof":if rng.chance(0.6){"shed"}else{"gable"},"material":"wood","storeys":[1,1]});
    let mut masses = massing::massing(&massing::Input {
        parts: &parts,
        arch: &arch,
        culture: &layout.culture,
        zone: "shanty",
        role: "dwelling.shanty",
        function: "domestic",
        landmark: false,
        wealth: 0.08,
        pressure: 0.8,
        small_home: true,
        population: layout.programme.as_ref().map_or(0, |p| p.population),
        fronts: &[hut.front],
        low_rural: true,
        distance: 1.3,
        seed,
        archetype: "",
    });
    let eave = rng.range(2.0, 2.7);
    if let Some(masses) = masses.as_array_mut() {
        for mass in masses {
            let cover = covers[rng.int(0, covers.len() as u32 - 1) as usize]
                .as_str()
                .unwrap_or("thatch");
            let tone = rng.range(0.18, 0.85);
            let patch = |m: &mut Value| {
                m["cover"] = json!(cover);
                m["wall"] = json!(wall);
                m["tone"] = json!(tone);
                m["floors"] = json!(1);
                m["eave_m"] = json!(eave);
                m["overhang_m"] = json!(0.12);
            };
            patch(mass);
            if let Some(volumes) = mass["volumes"].as_array_mut() {
                for volume in volumes {
                    patch(volume);
                }
            }
        }
    }
    Ok(
        json!({"id":format!("{}/building",hut.id),"parcel_id":hut.id,"seed":seed,
        "cadastral":[hut.shape],"buildable":[hut.shape],"roof_domain":[hut.shape],"reserves":[],
        "preview":shapes,"preview_parts":parts.iter().map(|(_,l)|l).collect::<Vec<_>>(),"placement_hint":[hut.shape],
        "accesses":[{"id":format!("{}/path",hut.id),"segment":hut.front,"kind":"public","width_m":1.1}],
        "party_boundaries":[],"neighbors":[],"function":"domestic",
        "culture":{"culture":layout.culture,"pack":culture::architecture_pack(&layout.culture).unwrap_or(""),"mode":"inspired","borrowing":null},
        "terrain":{"origin":c,"ground_z_m":surface.height_at(c),"gradient":[gradient(surface,c).x,gradient(surface,c).y],"water_z_m":null,"max_foundation_step_m":0.75},
        "programme":{"role":"dwelling.shanty","district_role":"shanty","label":"Habitation informelle","landmark":false,
            "composition":"detached","households":1,"wealth":0.08,"floors":[1,1],"shanty_flavour":pocket.flavour,
            "built_area_m2":g::area(&hut.shape),"party_walls":false,"massing":masses}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peripheral_pockets_are_town_only_and_preserve_the_formal_prefix() {
        // An empty tail must stop at an interior junction, preserving the
        // occupied branch and remapping its access after an empty path is removed.
        let street = |path| Street {
            path,
            widths: vec![2.],
            rank: 3,
            role: "path".into(),
        };
        let mut ways = vec![
            street(vec![Point { x: 0., y: 0. }, Point { x: 100., y: 0. }]),
            street(vec![Point { x: 20., y: 0. }, Point { x: 20., y: -30. }]),
            street(vec![Point { x: 60., y: 0. }, Point { x: 60., y: 20. }]),
        ];
        let mut huts = vec![Hut {
            id: "hut".into(),
            shape: g::rectangle(62., 12., 67., 18.),
            axis: Point { x: 1., y: 0. },
            front: [Point { x: 62., y: 12. }, Point { x: 62., y: 18. }],
            street: 7,
        }];
        let road = street(vec![Point { x: 0., y: -10. }, Point { x: 0., y: 10. }]);
        prune_paths(&mut ways, &[road], &mut huts, &[], 5);
        assert_eq!(ways.len(), 2);
        assert_eq!(ways[0].path.last().unwrap().x, 60.);
        assert_eq!(huts[0].street, 6);
        let n = 64;
        let heights = vec![10_f32; n * n];
        let water = vec![0_u8; n * n];
        let levels = vec![0_f32; n * n];
        let surface = Surface {
            geometry: None,
            width: 4000.,
            n,
            height: &heights,
            water: &water,
            interpolation: Default::default(),
        };
        let site = Site {
            key: "town".into(),
            name: String::new(),
            population: 10_000,
            culture: "medina".into(),
            center: Point { x: 2000., y: 2000. },
            radius: 260.,
        };
        let road = Street {
            path: vec![Point { x: 200., y: 2000. }, Point { x: 3800., y: 2000. }],
            widths: vec![6.],
            rank: 1,
            role: "road".into(),
        };
        let mut cfg = LayoutConfig {
            fortification: "none".into(),
            radius: 260.,
            ..Default::default()
        };
        cfg.footprint.budget = "radius".into();
        cfg.shanty_scale = 0.;
        let bare = generate_quarters(
            "shanty-proof",
            std::slice::from_ref(&site),
            &cfg,
            surface,
            std::slice::from_ref(&road),
        )
        .unwrap();
        cfg.shanty_scale = 1.;
        let built = generate_quarters(
            "shanty-proof",
            std::slice::from_ref(&site),
            &cfg,
            surface,
            std::slice::from_ref(&road),
        )
        .unwrap();
        let town = &built[0];
        let ext = extension(town).expect("a 10k medina should have peripheral informal pockets");
        assert!(!ext.pockets.is_empty());
        let mut recovered = formal_layout(town).into_owned();
        // Applied configuration is the sole intentional difference.
        recovered.config = bare[0].config.clone();
        assert_eq!(
            serde_json::to_value(&recovered).unwrap(),
            serde_json::to_value(&bare[0]).unwrap()
        );
        let mut hut_count = 0;
        for p in &ext.pockets {
            let shape = &town.quarters[p.quarter].shape;
            assert_eq!(town.quarters[p.quarter].zone, "shanty");
            assert!(p.huts.len() >= 6);
            for formal in &bare[0].quarters {
                assert!(!overlap(shape, &formal.shape));
            }
            for hut in &p.huts {
                assert!(hut.shape.outer.iter().all(|&p| g::contains(shape, p)));
                assert!(dry_shape(surface, &hut.shape, 0.65));
                assert!((11.0..45.0).contains(&g::area(&hut.shape)));
                assert!(hut.street >= ext.formal_streets && hut.street < town.streets.len());
            }
            for (i, hut) in p.huts.iter().enumerate() {
                for other in p.huts.iter().skip(i + 1) {
                    assert!(!overlap(&hut.shape, &other.shape));
                }
            }
            hut_count += p.huts.len();
        }
        assert!(hut_count <= MAX_HUTS && ext.pockets.len() <= MAX_POCKETS);
        assert!(
            town.structure
                .as_ref()
                .unwrap()
                .districts
                .iter()
                .any(|d| d.role == "shanty")
        );
        let mut replay = bare[0].clone();
        let key_seed = "shanty-proof";
        extend(
            key_seed,
            &mut replay,
            &site,
            &cfg,
            kinds::Kind::City,
            surface,
            std::slice::from_ref(&road),
        );
        assert_eq!(
            serde_json::to_value(extension(&replay)).unwrap(),
            serde_json::to_value(extension(town)).unwrap()
        );
        let parcels_cfg = ParcelConfig::default();
        let formal_parts = generate_parcels("shanty-proof", &bare, &parcels_cfg).unwrap();
        let parts = generate_parcels("shanty-proof", &built, &parcels_cfg).unwrap();
        assert!(hut_count <= remaining_households(formal_parts[0].programme.as_ref().unwrap()));
        let mut exhausted = formal_parts[0].programme.clone().unwrap();
        let wanted: f64 = exhausted
            .demands
            .iter()
            .filter(|d| d.unit == "domesticUnits")
            .map(|d| d.requested)
            .sum();
        let cap = (wanted * 1.3).floor().max(wanted.ceil());
        for a in &mut exhausted.allocations {
            a.households = 0.;
        }
        exhausted.allocations[0].households = cap;
        assert_eq!(remaining_households(&exhausted), 0);
        let mut capped = formal_parts[0].clone();
        capped.programme = Some(exhausted);
        allocate(town, &mut capped);
        assert_eq!(
            capped
                .programme
                .as_ref()
                .unwrap()
                .allocations
                .iter()
                .map(|a| a.households)
                .sum::<f64>(),
            cap
        );
        assert_eq!(
            capped
                .parcels
                .iter()
                .filter(|p| p.reason == "population-budget-open-patch")
                .count(),
            hut_count
        );
        let snapshot = serde_json::to_value(&capped).unwrap();
        allocate(town, &mut capped);
        assert_eq!(serde_json::to_value(&capped).unwrap(), snapshot);
        for part in [
            &parts[0],
            &programme::reallocate(&built, &parts).unwrap()[0],
        ] {
            let pr = part.programme.as_ref().unwrap();
            let wanted: f64 = pr
                .demands
                .iter()
                .filter(|d| d.unit == "domesticUnits")
                .map(|d| d.requested)
                .sum();
            let held: f64 = pr.allocations.iter().map(|a| a.households).sum();
            assert!(held <= (wanted * 1.3).floor().max(wanted.ceil()));
        }
        let prefix = formal_parts[0].parcels.len();
        assert_eq!(
            serde_json::to_value(&parts[0].parcels[..prefix]).unwrap(),
            serde_json::to_value(&formal_parts[0].parcels).unwrap()
        );
        let formal_allocations = &formal_parts[0].programme.as_ref().unwrap().allocations;
        assert_eq!(
            serde_json::to_value(
                &parts[0].programme.as_ref().unwrap().allocations[..formal_allocations.len()]
            )
            .unwrap(),
            serde_json::to_value(formal_allocations).unwrap()
        );
        assert_eq!(
            parts[0]
                .parcels
                .iter()
                .filter(|p| p.family == "shanty")
                .count(),
            hut_count
        );
        let formal_again = programme::reallocate(&bare, &formal_parts).unwrap();
        let again = programme::reallocate(&built, &parts).unwrap();
        assert_eq!(
            serde_json::to_value(&again[0].parcels[..prefix]).unwrap(),
            serde_json::to_value(&formal_again[0].parcels).unwrap()
        );
        assert_eq!(
            again[0]
                .parcels
                .iter()
                .filter(|p| p.family == "shanty")
                .count(),
            hut_count
        );
        assert_eq!(
            serde_json::to_value(
                &again[0].programme.as_ref().unwrap().allocations[..formal_again[0]
                    .programme
                    .as_ref()
                    .unwrap()
                    .allocations
                    .len()]
            )
            .unwrap(),
            serde_json::to_value(&formal_again[0].programme.as_ref().unwrap().allocations).unwrap()
        );
        let before = building_sites::requests_range(
            "shanty-proof",
            &bare,
            &formal_parts,
            surface,
            &levels,
            None,
            0,
            5,
        )
        .unwrap();
        let after = building_sites::requests_range(
            "shanty-proof",
            &built,
            &parts,
            surface,
            &levels,
            None,
            0,
            5,
        )
        .unwrap();
        assert!(
            before == after,
            "formal building footprints and massing must keep their prefix"
        );
        let offset = formal_allocations
            .iter()
            .filter(|a| a.role != "open.garden")
            .count();
        let requests = building_sites::requests_range(
            "shanty-proof",
            &built,
            &parts,
            surface,
            &levels,
            None,
            offset,
            offset + hut_count,
        )
        .unwrap();
        assert_eq!(requests.len(), hut_count);
        let mut covers = std::collections::BTreeSet::new();
        for request in &requests {
            assert_eq!(request["programme"]["district_role"], "shanty");
            let preview = request["preview"].as_array().unwrap();
            let massing = request["programme"]["massing"].as_array().unwrap();
            assert!(!preview.is_empty() && preview.len() == massing.len());
            for m in massing {
                assert_eq!(m["floors"], 1);
                assert!(m["eave_m"].as_f64().unwrap() < 3.);
                covers.insert(m["cover"].as_str().unwrap().to_owned());
            }
        }
        assert!(
            covers.len() > 1,
            "roofs should show several salvage materials"
        );
        if let Ok(path) = std::env::var("SHANTY_PROOF_OUT") {
            std::fs::write(
                path,
                serde_json::to_vec(&json!({"layout":town,"requests":requests})).unwrap(),
            )
            .unwrap();
        }
        let village = Site {
            population: 800,
            ..site.clone()
        };
        let village_layout = generate_quarters(
            "shanty-proof",
            &[village],
            &cfg,
            surface,
            std::slice::from_ref(&road),
        )
        .unwrap();
        assert!(extension(&village_layout[0]).is_none());
        for (population, culture, kind, intent, scale) in [
            (
                800,
                "medina",
                kinds::Kind::NucleatedVillage,
                "settlement",
                1.,
            ),
            (10_000, "elven", kinds::Kind::City, "settlement", 1.),
            (10_000, "medina", kinds::Kind::Camp, "settlement", 1.),
            (10_000, "medina", kinds::Kind::City, "activity", 1.),
            (10_000, "medina", kinds::Kind::City, "settlement", 0.),
            (10_000, "chinese", kinds::Kind::City, "settlement", 1.), // no river
            (10_000, "ottoman", kinds::Kind::City, "settlement", 1.), // no slope
        ] {
            let mut layout = bare[0].clone();
            layout.culture = culture.into();
            let site = Site {
                population,
                culture: culture.into(),
                ..site.clone()
            };
            let mut cfg = cfg.clone();
            cfg.programme.intent = intent.into();
            cfg.shanty_scale = scale;
            extend(
                key_seed,
                &mut layout,
                &site,
                &cfg,
                kind,
                surface,
                std::slice::from_ref(&road),
            );
            assert!(
                extension(&layout).is_none(),
                "unexpected informal quarter for {population} {culture} {intent} {scale}"
            );
        }
        // Controlled banks and hills exercise both positive siting rules; the
        // dry flat fixture above already proves that neither invents terrain.
        let square = g::rectangle(1800., 1800., 2200., 2200.);
        let mut proto = bare[0].clone();
        proto.quarters = vec![Quarter {
            shape: square.clone(),
            phase: 0,
            zone: "core".into(),
        }];
        proto.blocks = vec![Block {
            shape: square.clone(),
            quarter: 0,
            kind: "residential".into(),
            axis: Point { x: 1., y: 0. },
            zone: "core".into(),
            phase: Some(0),
        }];
        proto.enclosures.clear();
        proto.streets = vec![
            Street {
                path: vec![Point { x: 1600., y: 2250. }, Point { x: 2400., y: 2250. }],
                widths: vec![5.],
                rank: 1,
                role: "road".into(),
            },
            Street {
                path: vec![Point { x: 2250., y: 1600. }, Point { x: 2250., y: 2400. }],
                widths: vec![5.],
                rank: 1,
                role: "road".into(),
            },
        ];
        proto.structure = Some(UrbanStructure {
            allocated: vec![square],
            ..Default::default()
        });
        let hill = (0..n * n)
            .map(|i| (10. + 0.12 * (i % n) as f64 * 4000. / n as f64) as f32)
            .collect::<Vec<_>>();
        let river = (0..n * n)
            .map(|i| if (37..39).contains(&(i / n)) { 3_u8 } else { 0 })
            .collect::<Vec<_>>();
        for (culture, surface) in [
            (
                "ottoman",
                Surface {
                    height: &hill,
                    ..surface
                },
            ),
            (
                "chinese",
                Surface {
                    water: &river,
                    ..surface
                },
            ),
        ] {
            let mut layout = proto.clone();
            layout.culture = culture.into();
            extend(
                key_seed,
                &mut layout,
                &site,
                &cfg,
                kinds::Kind::City,
                surface,
                &[],
            );
            assert!(
                extension(&layout).is_some(),
                "suitable {culture} terrain should admit an informal pocket"
            );
        }
        let mut other = bare[0].clone();
        extend(
            "another-shanty-seed",
            &mut other,
            &site,
            &cfg,
            kinds::Kind::City,
            surface,
            std::slice::from_ref(&road),
        );
        assert_ne!(
            serde_json::to_value(extension(&other)).unwrap(),
            serde_json::to_value(ext).unwrap()
        );
        eprintln!(
            "shanty: {} pockets, {hut_count} huts; formal plan/parcels/allocations/buildings stable; eligibility and roof materials verified",
            ext.pockets.len()
        );
    }
}
