//! Geography first: preserve regional corridors, then partition their dry land.
//! The cultural envelope is a growth budget, not a mandatory peripheral street.
use crate::urban::warnings;
use super::{
    Enclosure, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface, UrbanStructure,
    geometry as g, profiles, routing,
};
use crate::rng::Rng;
use std::f64::consts::{PI, TAU};

mod approaches;
use approaches::{camp_approaches, camp_entrance, join_crossing_approaches, trim_guide_tips};
#[cfg(test)]
mod camp_approach_tests;
mod lattice;
use lattice::{chord, inside_path, lattice_approaches};
mod spines;
use spines::{cultural_spines, simple_path, water_angle};
mod landing_rows;
use landing_rows::add_landing_rows;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod v7_grid_tests;

pub(super) mod harbour;

pub(super) struct Plan {
    pub envelope: Shape,
    pub structure: Option<UrbanStructure>,
    pub quarters: Vec<Quarter>,
    pub streets: Vec<Street>,
    pub enclosures: Vec<Enclosure>,
    pub warnings: Vec<String>,
}
fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn point(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}
fn nearest(p: Point, roads: &[Street]) -> Option<(f64, Point, f64)> {
    roads
        .iter()
        .flat_map(|s| s.path.windows(2))
        .map(|w| {
            let (d, _, q) = g::distance(p, w[0], w[1]);
            (d, q, (w[1].y - w[0].y).atan2(w[1].x - w[0].x))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
}

/// Prefer an entering main regional road over a nearby track or a generated
/// footprint guide. Use its local tangent, independent of direction and vertices.
pub(super) fn regional_axis(p: Point, reach: f64, roads: &[Street]) -> Option<f64> {
    roads
        .iter()
        .enumerate()
        .filter_map(|(i, s)| {
            if !matches!(
                s.role.as_str(),
                "regional" | "bridge" | "ford" | "causeway" | "approach"
            ) {
                return None;
            }
            let mut score = 0.0;
            let mut tangent = None;
            for (j, pair) in s.path.windows(2).enumerate() {
                let length = dist(pair[0], pair[1]);
                let (d, _, _) = g::distance(p, pair[0], pair[1]);
                if length <= 1e-6 || d > reach {
                    continue;
                }
                let width = s
                    .widths
                    .get(j)
                    .copied()
                    .or_else(|| s.widths.last().copied())
                    .unwrap_or(4.0);
                score +=
                    length.min(reach * 2.0) * width / (1.0 + d / (reach * 0.3).max(1.0)).powi(2);
                if tangent.is_none_or(|(nearest, _)| d < nearest) {
                    tangent = Some((d, (pair[1].y - pair[0].y).atan2(pair[1].x - pair[0].x)));
                }
            }
            tangent.map(|(_, angle)| (s.rank, score, i, angle))
        })
        .min_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| b.1.total_cmp(&a.1))
                .then_with(|| a.2.cmp(&b.2))
        })
        .map(|v| v.3)
}
/// Exact geometric clipping, independent of water: existing crossings survive.
pub(super) fn clip(st: &Street, shape: &Shape) -> Vec<Street> {
    let mut result = vec![];
    let mut path = vec![];
    let mut widths = vec![];
    for (i, w) in st.path.windows(2).enumerate() {
        let mut ts = vec![0.0, 1.0];
        for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                if let Some((t, _)) = g::segment_hit(w[0], w[1], a, b) {
                    ts.push(t.clamp(0.0, 1.0));
                }
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() < 1e-8);
        let wa = st
            .widths
            .get(i)
            .copied()
            .or_else(|| st.widths.first().copied())
            .unwrap_or(4.0);
        let wb = st.widths.get(i + 1).copied().unwrap_or(wa);
        for t in ts.windows(2) {
            let a = point(w[0], w[1], t[0]);
            let b = point(w[0], w[1], t[1]);
            if g::contains(shape, point(a, b, 0.5)) {
                if path.last().is_some_and(|&p| dist(p, a) > 1e-5) {
                    result.push(Street {
                        path: std::mem::take(&mut path),
                        widths: std::mem::take(&mut widths),
                        rank: st.rank,
                        role: st.role.clone(),
                    });
                }
                if path.is_empty() {
                    path.push(a);
                    widths.push(wa + (wb - wa) * t[0]);
                }
                path.push(b);
                widths.push(wa + (wb - wa) * t[1]);
            } else if path.len() > 1 {
                result.push(Street {
                    path: std::mem::take(&mut path),
                    widths: std::mem::take(&mut widths),
                    rank: st.rank,
                    role: st.role.clone(),
                });
            }
        }
    }
    if path.len() > 1 {
        result.push(Street {
            path,
            widths,
            rank: st.rank,
            role: st.role.clone(),
        });
    }
    result
}
pub(super) fn split_by(shapes: &mut Vec<Shape>, street: &Street) {
    let previous = std::mem::take(shapes);
    for s in previous {
        let mut pieces = vec![s];
        // A regional polyline can enter a non-convex region more than once.
        for cut in clip(street, &pieces[0]) {
            pieces = pieces
                .into_iter()
                .flat_map(|s| {
                    let mut children = vec![s];
                    // Earlier diameters may already divide this chord. Reclip to
                    // each child so every split starts and ends on its boundary.
                    for clipped in clip(&cut, &children[0]) {
                        children = children
                            .into_iter()
                            .flat_map(|part| {
                                if let Some((a, b)) = g::split(&part, &clipped.path) {
                                    vec![a, b]
                                } else {
                                    vec![part]
                                }
                            })
                            .collect();
                    }
                    children
                })
                .collect();
        }
        shapes.extend(pieces);
    }
}
fn split_joined_roads(regions: &mut Vec<Shape>, roads: &[Street]) {
    // Regional networks commonly arrive as separate branches ending at the town
    // marker. Two connected branches form a real boundary-to-boundary chord.
    for (i, left) in roads.iter().enumerate() {
        if left.path.len() < 2 {
            continue;
        }
        for right in &roads[i + 1..] {
            if right.path.len() < 2 {
                continue;
            }
            for a in [0, left.path.len() - 1] {
                for b in [0, right.path.len() - 1] {
                    if dist(left.path[a], right.path[b]) > 0.2 {
                        continue;
                    }
                    let mut path = left.path.clone();
                    if a == 0 {
                        path.reverse();
                    }
                    let mut tail = right.path.clone();
                    if b > 0 {
                        tail.reverse();
                    }
                    path.extend(tail.into_iter().skip(1));
                    if !simple_path(&path, false) {
                        continue;
                    }
                    split_by(
                        regions,
                        &Street {
                            path,
                            widths: vec![],
                            rank: left.rank.min(right.rank),
                            role: "street".into(),
                        },
                    );
                }
            }
        }
    }
}
pub(super) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
) -> Plan {
    generate_domain(seed, site, cfg, m, surface, roads, radius, None)
}

/// The same shared armature runs inside each actual land component. The supplied
/// domain retains concavities and holes; it is never replaced by its convex hull.
#[allow(clippy::too_many_arguments)]
pub(super) fn generate_domain(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
    domain: Option<&Shape>,
) -> Plan {
    generate_oriented_domain(seed, site, cfg, m, surface, roads, radius, domain, None)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn generate_oriented_domain(
    seed: &str, site: &Site, cfg: &LayoutConfig, m: &Morph, surface: Surface<'_>,
    roads: &[Street], radius: f64, domain: Option<&Shape>, grid_angle: Option<f64>,
) -> Plan {
    let mut rng = Rng::new(seed).fork("geographic-plan");
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let profile = if cfg.scope == "settlement" {
        profiles::settlement_profile(culture, site.population, cfg.phases)
    } else {
        profiles::profile(culture)
    };
    let pattern_override = cfg.tissue != "culture"
        || cfg.params.get("streetOp").is_some()
        || cfg.preset != "culture"
        || cfg.scope == "settlement" && cfg.recipe != "auto";
    let pattern = if cfg.tissue != "culture" {
        match cfg.tissue.as_str() {
            "grid" => "grid",
            "radial" => "radial",
            "terraces" => "terraces",
            "clusters" => "dispersed",
            _ => "organic",
        }
    } else if pattern_override {
        m.text("streetOp")
    } else {
        profile.pattern
    };
    let c = site.center;
    let mut angle = nearest(c, roads)
        .map(|v| v.2)
        .unwrap_or_else(|| rng.range(0.0, PI));
    let step = (surface.width / surface.n as f64).max(5.0);
    let gx = surface.height_at(Point {
        x: c.x + step,
        y: c.y,
    }) - surface.height_at(Point {
        x: c.x - step,
        y: c.y,
    });
    let gy = surface.height_at(Point {
        x: c.x,
        y: c.y + step,
    }) - surface.height_at(Point {
        x: c.x,
        y: c.y - step,
    });
    let orientation_override = cfg.params.get("orientation").is_some() || cfg.preset != "culture";
    let orientation = if orientation_override {
        m.text("orientation")
    } else {
        profile.orientation
    };
    if orientation == "cardinal" || profile.gates == "cardinal" && !orientation_override {
        angle = 0.0;
    } else if orientation == "terrain" && gx.hypot(gy) > 0.1 {
        angle = gy.atan2(gx) + PI * 0.5;
    } else if orientation == "water" {
        angle = water_angle(surface, c, radius).unwrap_or(angle);
    }
    if domain.is_some() {
        angle += cfg.footprint.orientation.to_radians();
    }
    // A planned cardinal grid is laid out to the compass, like its walls:
    // regional roads join its gates instead of turning the lattice.
    let compass = pattern == "grid" && orientation == "cardinal";
    if cfg.axis_alignment == "regional"
        && !orientation_override
        && !compass
        && let Some(regional) = regional_axis(c, radius * 1.5, roads)
    {
        angle = regional + cfg.footprint.orientation.to_radians();
    }
    if pattern == "grid" && let Some(a) = grid_angle { angle = a; }
    if cfg.align_enclosed_grid && pattern == "grid"
        && matches!(profiles::fortification(profile, &cfg.fortification, site.population), "wall" | "palisade")
        && let Some(domain) = domain {
        angle = super::quarters::outline_frame(domain);
    }
    let fortified = profiles::fortification(profile, &cfg.fortification, site.population);
    let closed = matches!(fortified, "wall" | "palisade" | "hedge");
    let rect = (!pattern_override
        && matches!(profile.enclosure, "rect" | "rounded-rect" | "square"))
        || pattern == "grid";
    let linear = matches!(pattern, "linear" | "dispersed") || site.population < 150;
    // Open settlements grow farther along useful approaches. Their extent is a
    // budget for infill, not a geometric wall imposed on every street and plot.
    let growth_axes: Vec<f64> = roads
        .iter()
        .flat_map(|s| s.path.iter())
        .filter(|&&p| dist(p, c) > radius * 0.45 && dist(p, c) < radius * 1.8)
        .map(|p| (p.y - c.y).atan2(p.x - c.x))
        .collect();
    let phase = rng.range(0.0, TAU);
    let mut outer = vec![];
    for i in 0..80 {
        let a = i as f64 * TAU / 80.0;
        let (u, v) = (a.cos(), a.sin());
        let rectangular = if rect && closed {
            1.0 / u.abs().max(v.abs()).max(0.1)
        } else {
            1.0
        };
        let variation = if closed && (rect || matches!(profile.enclosure, "circle" | "square")) {
            1.0
        } else {
            1.0 + 0.09 * (a * 3.0 + phase).sin() + 0.055 * (a * 5.0 - phase * 0.7).cos()
        };
        let growth = if closed {
            1.0
        } else {
            let alignment = growth_axes
                .iter()
                .map(|road| (a + angle - road).cos().max(0.0).powi(12))
                .fold(0.0, f64::max);
            0.88 + 0.27 * alignment
        };
        let rx = radius * if linear { 1.25 } else { 1.0 };
        let ry = radius
            * if linear {
                0.48
            } else if matches!(profile.enclosure, "circle" | "square") {
                1.0
            } else {
                0.86
            };
        let x = u * rx * rectangular * variation * growth;
        let y = v * ry * rectangular * variation * growth;
        outer.push(Point {
            x: c.x + x * angle.cos() - y * angle.sin(),
            y: c.y + x * angle.sin() + y * angle.cos(),
        });
    }
    let envelope = domain.cloned().unwrap_or_else(|| {
        g::normalized(Shape {
            outer,
            holes: vec![],
        })
    });
    let mut regions = g::dry_clip(&surface, &envelope);
    regions.retain(|s| g::area(s) > 25.0);
    let dry = regions.clone();
    let camp = !m.text("campLayout").is_empty() || cfg.settlement_form == "camp";
    let mut streets: Vec<_> = roads.iter().flat_map(|s| clip(s, &envelope)).collect();
    let mut camp_guide = false;
    if camp {
        camp_guide = camp_entrance(&mut streets, &envelope, c, radius, roads);
        if !camp_guide && (m.text("campLayout") != "rows" || cfg.natural_camp_approaches && m.flag("villagePaths")) {
            // Validate the entrance that will remain, not a discarded drive
            // through a steep centre that the footpaths need not cross.
            camp_approaches(&mut streets, &envelope, m.number_or("campPath", m.number_or("footpathWidth", 3.0)).max(2.0), true);
        }
    }
    let mut warnings = vec![];
    let approach = nearest(c, roads).filter(|v| v.0 > radius * 0.7 && v.0 < radius * 2.5);
    let (mut x0, mut y0, mut x1, mut y1) = g::bbox(&envelope);
    if let Some((_, anchor, _)) = approach {
        x0 = x0.min(anchor.x - step * 2.0);
        y0 = y0.min(anchor.y - step * 2.0);
        x1 = x1.max(anchor.x + step * 2.0);
        y1 = y1.max(anchor.y + step * 2.0);
    }
    let mut planner = routing::RoutePlanner::new(surface, (x0, y0, x1, y1));
    planner.set_adaptation(cfg.site_adaptation);
    // Dry portions of imported roads must satisfy the same physical contract.
    let mut retained = vec![];
    for st in streets {
        if matches!(st.role.as_str(), "bridge" | "ford" | "causeway")
            || routing::path_clear(surface, &st.path, cfg.max_street_grade)
                && (cfg.site_adaptation == 0.0
                    || st.role == "regional"
                    || st
                        .path
                        .windows(2)
                        .all(|p| routing::segment_grade(surface, p[0], p[1]) < 0.015))
        {
            retained.push(st);
        } else if let Some(path) = planner.route_within(
            st.path[0],
            *st.path.last().unwrap(),
            cfg.max_street_grade,
            &envelope,
        ) {
            let width = st.widths.first().copied().unwrap_or(5.0);
            retained.push(Street {
                widths: vec![width; path.len()],
                path,
                ..st
            });
        } else {
            warnings.push(warnings::regional_approach_steep());
        }
    }
    streets = retained;
    join_crossing_approaches(&mut streets, roads, surface, cfg.max_street_grade);
    // The generated entrance already stops at the heart's edge. Clipping it
    // to the outer belt loses the handover to camp paths and can leave it
    // entirely outside the final hedge; keep its full, validated approach.
    if camp && !camp_guide && (m.text("campLayout") != "rows" || cfg.natural_camp_approaches && m.flag("villagePaths")) {
        camp_approaches(&mut streets, &envelope, m.number_or("campPath", m.number_or("footpathWidth", 3.0)).max(2.0), true);
    }
    if !camp {
        trim_guide_tips(&mut streets, &envelope);
    }
    if compass {
        lattice_approaches(
            &mut streets,
            &dry,
            &envelope,
            &mut planner,
            c,
            angle,
            radius,
            surface,
            cfg,
        );
    }
    for road in &streets {
        split_by(&mut regions, road);
    }
    split_joined_roads(&mut regions, &streets);
    // A camp (kraal, tipi circle, ordu, longhouse or plaza village): one
    // quarter, paths only, laid out by `parcels/camp.rs`.
    if !camp && (pattern == "radial" || pattern == "organic" || profile.gates == "cardinal") {
        cultural_spines(
            &mut regions,
            &mut streets,
            &dry,
            &mut planner,
            c,
            angle,
            radius,
            cfg,
            m,
            pattern == "radial",
            profile.gates == "cardinal",
            &mut rng,
        );
        split_joined_roads(&mut regions, &streets);
    }
    let desired = if camp {
        1
    } else if pattern == "grid" && site.population < 1200 {
        // A walled grid always has its crossing streets, however small its land.
        (cfg.count * cfg.rings).clamp(4, 256)
    } else {
        (cfg.count * cfg.rings).min(256)
    };
    // Quarter streets follow the street grade. A steep domain where not one of them
    // can be traced would stay a single unserved quarter: a culture that builds
    // stairs then cuts its quarters by stairs.
    let stairs = profiles::stairs_allowed(cfg, culture) && domain.is_some();
    let mut cut_any = false;
    for cut_grade in [cfg.max_street_grade, cfg.max_stair_grade] {
        if cut_grade != cfg.max_street_grade && (!stairs || cut_any || regions.len() >= desired) {
            break;
        }
        let mut attempts = 0;
        let mut rejected = vec![];
        while regions.len() < desired && attempts < desired * 5 {
            attempts += 1;
            let Some((index, _)) = regions
                .iter()
                .enumerate()
                .filter(|(i, _)| !rejected.contains(i))
                .max_by(|(_, a), (_, b)| g::area(a).total_cmp(&g::area(b)))
            else {
                break;
            };
            let shape = &regions[index];
            let center = g::interior_point(shape);
            let mut selected = None;
            // A planned grid divides its quarters along its own lattice: one town
            // orientation and ward lines at the culture's spacing through the centre,
            // straight wherever the slope allows, so the quarter streets are the
            // lines the blocks continue and junctions are crossroads.
            let lattice = pattern == "grid";
            let local_angle = if lattice {
                angle
            } else if cfg.axis_alignment == "regional"
                && !orientation_override
                && let Some(regional) = regional_axis(center, radius * 1.5, roads)
            {
                regional + cfg.footprint.orientation.to_radians()
            } else if pattern == "terraces" || profile.stairs {
                let dx = surface.height_at(Point {
                    x: center.x + step,
                    y: center.y,
                }) - surface.height_at(Point {
                    x: center.x - step,
                    y: center.y,
                });
                let dy = surface.height_at(Point {
                    x: center.x,
                    y: center.y + step,
                }) - surface.height_at(Point {
                    x: center.x,
                    y: center.y - step,
                });
                if dx.hypot(dy) > 0.1 {
                    dy.atan2(dx) + PI * 0.5
                } else {
                    angle
                }
            } else {
                angle
            };
            let spacing = m.pair("gridSpacing");
            let mut cuts = vec![];
            for turn in [0.0, PI * 0.5, PI * 0.25, -PI * 0.25] {
                if rect && turn.abs() == PI * 0.25 {
                    continue;
                }
                let heading = local_angle + turn;
                let mut sp = spacing[usize::from(turn != 0.0)];
                // A small settlement's ward lines keep the module of its own land: a 240 m
                // lattice cannot cross a 160 m walled core, so the grid scales down with it.
                if site.population < 1200 {
                    sp = sp.min(0.55 * g::area(shape).sqrt());
                }
                if lattice && sp > 0.0 {
                    let n = Point {
                        x: -heading.sin(),
                        y: heading.cos(),
                    };
                    let offset = (center.x - c.x) * n.x + (center.y - c.y) * n.y;
                    let k = (offset / sp).round();
                    for line in [k, k - 1.0, k + 1.0] {
                        let shift = line * sp - offset;
                        cuts.push((
                            heading,
                            Point {
                                x: center.x + n.x * shift,
                                y: center.y + n.y * shift,
                            },
                        ));
                    }
                } else {
                    cuts.push((heading, center));
                }
            }
            for (heading, through) in cuts {
                let Some((a, b)) = chord(shape, through, heading) else {
                    continue;
                };
                let inset = (1e-7 / dist(a, b).max(0.1)).min(0.1);
                let start = point(a, b, inset);
                let end = point(b, a, inset);
                let straight =
                    lattice && routing::path_clear(surface, &[start, end], cfg.max_street_grade);
                let Some(path) = (if straight {
                    Some(vec![start, end])
                } else {
                    planner.route(start, end, cut_grade)
                }) else {
                    continue;
                };
                if !inside_path(shape, &path) {
                    continue;
                }
                let Some((left, right)) = g::split(shape, &path) else {
                    continue;
                };
                if g::area(&left).min(g::area(&right)) < g::area(shape) * 0.12 {
                    continue;
                }
                let balance = (g::area(&left) - g::area(&right)).abs() / g::area(shape);
                if selected
                    .as_ref()
                    .is_none_or(|(cost, _, _, _)| balance < *cost)
                {
                    selected = Some((balance, left, right, path));
                }
            }
            if let Some((_, a, b, path)) = selected {
                let width = m.width(if streets.is_empty() { 0 } else { 1 }, &mut rng);
                streets.push(Street {
                    widths: vec![width; path.len()],
                    path,
                    rank: 1,
                    role: "street".into(),
                });
                regions[index] = a;
                regions.push(b);
                rejected.clear();
                cut_any = true;
                if cut_grade != cfg.max_street_grade && !warnings.iter().any(|w: &String| w == warnings::QUARTER_STAIRS) {
                    warnings.push(warnings::quarter_stairs());
                }
            } else {
                rejected.push(index);
            }
        }
    }
    // Connect a town placed beside a regional route, without moving that route.
    if let Some((_, anchor, _)) = approach {
        let target = nearest(anchor, &streets).map(|v| v.1).unwrap_or(c);
        if let Some(path) = planner.route(anchor, target, cfg.max_street_grade) {
            streets.push(Street {
                widths: vec![m.width(1, &mut rng); path.len()],
                path,
                rank: 1,
                role: "approach".into(),
            });
        }
    }
    // Every navigable waterfront builds quays, independently of culture.
    if surface.n > 1 {
        harbour::quays(&regions, &mut streets, surface, cfg, site, culture, false);
        // The landing row gives port services their own waterfront blocks.
        if streets.iter().any(|s| s.role == "quay") {
            add_landing_rows(&regions, &mut streets, roads, surface, cfg, m, culture);
        }
    }
    let mut enclosures = vec![];
    if closed {
        for region in g::dry_clip(&surface, &envelope) {
            let mut path = region.outer;
            if let Some(&p) = path.first() {
                path.push(p);
            }
            let mut gates = vec![];
            for st in &streets {
                for w in st.path.windows(2) {
                    for e in path.windows(2) {
                        if let Some((_, p)) = g::segment_hit(w[0], w[1], e[0], e[1])
                            && !gates.iter().any(|&q| dist(p, q) < 8.0)
                        {
                            gates.push(p);
                        }
                    }
                }
            }
            // Street ends lie on the wall after exact clipping, including t=0.
            for st in &streets {
                for &p in [st.path.first(), st.path.last()].into_iter().flatten() {
                    if path.windows(2).any(|e| g::distance(p, e[0], e[1]).0 < 1.0)
                        && !gates.iter().any(|&q| dist(p, q) < 8.0)
                    {
                        gates.push(p);
                    }
                }
            }
            enclosures.push(Enclosure {
                path,
                kind: fortified.into(),
                gates,
                towers: vec![],
                ..Default::default()
            });
        }
    }
    let quarters = regions
        .into_iter()
        .map(|shape| {
            let d = dist(g::centroid(&shape), c) / radius;
            let zone = if cfg.zone != "auto" {
                cfg.zone.clone()
            } else if site.population < 500 {
                "village".into()
            } else if d < 0.42 {
                "core".into()
            } else if d < 0.72 {
                "middle".into()
            } else {
                "edge".into()
            };
            Quarter {
                shape,
                phase: usize::from(d > 0.65),
                zone,
            }
        })
        .collect();
    if streets.is_empty() {
        warnings.push(warnings::no_quarter_road());
    }
    Plan {
        envelope,
        structure: None,
        quarters,
        streets,
        enclosures,
        warnings,
    }
}
