//! Geography first: preserve regional corridors, then partition their dry land.
//! The cultural envelope is a growth budget, not a mandatory peripheral street.
use super::{
    Enclosure, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface, UrbanStructure,
    geometry as g, profiles, routing,
};
use crate::rng::Rng;
use std::f64::consts::{PI, TAU};

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
fn chord(s: &Shape, c: Point, angle: f64) -> Option<(Point, Point)> {
    let d = Point {
        x: angle.cos() * 100000.0,
        y: angle.sin() * 100000.0,
    };
    let a = Point {
        x: c.x - d.x,
        y: c.y - d.y,
    };
    let b = Point {
        x: c.x + d.x,
        y: c.y + d.y,
    };
    let mut hits: Vec<_> = s
        .outer
        .iter()
        .zip(s.outer.iter().cycle().skip(1))
        .take(s.outer.len())
        .filter_map(|(&p, &q)| g::segment_hit(a, b, p, q))
        .collect();
    hits.sort_by(|a, b| a.0.total_cmp(&b.0));
    hits.dedup_by(|a, b| dist(a.1, b.1) < 0.01);
    hits.windows(2)
        .filter(|w| g::contains(s, point(w[0].1, w[1].1, 0.5)))
        .max_by(|a, b| dist(a[0].1, a[1].1).total_cmp(&dist(b[0].1, b[1].1)))
        .map(|w| (w[0].1, w[1].1))
}
fn inside_path(s: &Shape, path: &[Point]) -> bool {
    path.windows(2).all(|w| {
        let n = (dist(w[0], w[1]) / 5.0).ceil().max(1.0) as usize;
        (0..n).all(|i| g::contains(s, point(w[0], w[1], (i as f64 + 0.5) / n as f64)))
    })
}
/// Fit the local bank rather than pointing toward the first wet raster cell.
/// The fit smooths cell stair-steps without changing the authoritative water mask.
fn water_angle(surface: Surface<'_>, center: Point, radius: f64) -> Option<f64> {
    let cell = surface.width / surface.n as f64;
    let reach = (radius * 1.5).max(cell * 4.0);
    let lo = |v: f64| ((v - reach) / cell).floor().max(0.0) as usize;
    let hi = |v: f64| (((v + reach) / cell).ceil() as usize).min(surface.n - 1);
    let mut banks = vec![];
    for y in lo(center.y)..=hi(center.y) {
        for x in lo(center.x)..=hi(center.x) {
            let wet = surface.water[y * surface.n + x] != 0;
            if x + 1 < surface.n && wet != (surface.water[y * surface.n + x + 1] != 0) {
                banks.push(Point {
                    x: (x + 1) as f64 * cell,
                    y: (y as f64 + 0.5) * cell,
                });
            }
            if y + 1 < surface.n && wet != (surface.water[(y + 1) * surface.n + x] != 0) {
                banks.push(Point {
                    x: (x as f64 + 0.5) * cell,
                    y: (y + 1) as f64 * cell,
                });
            }
        }
    }
    let anchor = *banks
        .iter()
        .min_by(|&&a, &&b| dist(a, center).total_cmp(&dist(b, center)))?;
    let window = (radius * 0.4).max(cell * 2.0);
    let mut weight = 0.0;
    let mut mean = Point { x: 0.0, y: 0.0 };
    let weighted: Vec<_> = banks
        .into_iter()
        .filter_map(|p| {
            let d = dist(p, anchor) / window;
            (d < 2.0).then_some((p, (1.0 + d * d).powi(-2)))
        })
        .collect();
    for &(p, w) in &weighted {
        weight += w;
        mean.x += p.x * w;
        mean.y += p.y * w;
    }
    if weight <= 0.0 || weighted.len() < 2 {
        return None;
    }
    mean.x /= weight;
    mean.y /= weight;
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for (p, w) in weighted {
        let x = p.x - mean.x;
        let y = p.y - mean.y;
        xx += w * x * x;
        xy += w * x * y;
        yy += w * y * y;
    }
    ((xx - yy).hypot(2.0 * xy) > 1e-8).then(|| 0.5 * (2.0 * xy).atan2(xx - yy))
}
fn simple_path(path: &[Point], closed: bool) -> bool {
    let last = path.len().saturating_sub(2);
    for (i, a) in path.windows(2).enumerate() {
        for (j, b) in path.windows(2).enumerate().skip(i + 2) {
            if closed && i == 0 && j == last {
                continue;
            }
            if g::segment_hit(a[0], a[1], b[0], b[1]).is_some() {
                return false;
            }
        }
    }
    true
}
/// A connected pair of routed arms supplies radial growth without forcing a
/// straight wedge through a river or steep hill. Existing corridors stay first.
#[allow(clippy::too_many_arguments)]
fn cultural_spines(
    regions: &mut Vec<Shape>,
    streets: &mut Vec<Street>,
    dry: &[Shape],
    planner: &mut routing::RoutePlanner<'_>,
    center: Point,
    angle: f64,
    radius: f64,
    cfg: &LayoutConfig,
    m: &Morph,
    radial: bool,
    cardinal: bool,
    rng: &mut Rng,
) {
    let Some(shape) = dry.iter().find(|s| g::contains(s, center)) else {
        return;
    };
    let nucleus = nearest(center, streets)
        .filter(|v| v.0 < radius * 0.25)
        .map(|v| v.1)
        .filter(|&p| g::contains(shape, p))
        .unwrap_or(center);
    let listed = |k: &str| {
        m.value["streets"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(k)))
    };
    let diameters = if radial {
        cfg.count.div_ceil(2).clamp(2, 8)
    } else {
        2
    };
    // Gate-to-gate spines (souk, bazaar) wander: two lateral sine waypoints
    // per arm, scaled by the cultural `spineAmp`, still routed on dry, graded land.
    let amplitude = if listed("gateToGate") {
        m.number("spineAmp") * (radius / 150.0).clamp(1.0, 4.0)
    } else {
        0.0
    };
    let wander = |from: Point, to: Point, planner: &mut routing::RoutePlanner<'_>, sign: f64| {
        let mut stops = vec![from];
        if amplitude > 0.0 {
            let (dx, dy) = (to.x - from.x, to.y - from.y);
            let l = dx.hypot(dy).max(1e-6);
            for (t, phase) in [(1.0 / 3.0, 1.0), (2.0 / 3.0, -0.6)] {
                let p = Point {
                    x: from.x + dx * t - dy / l * amplitude * phase * sign,
                    y: from.y + dy * t + dx / l * amplitude * phase * sign,
                };
                if g::contains(shape, p) {
                    stops.push(p);
                }
            }
        }
        stops.push(to);
        let mut path = vec![from];
        for w in stops.windows(2) {
            path.extend(
                planner
                    .route(w[0], w[1], cfg.max_street_grade)?
                    .into_iter()
                    .skip(1),
            );
        }
        Some(path)
    };
    for i in 0..diameters {
        let bearing = angle
            + i as f64 * PI / diameters as f64
            + if cardinal || !radial || i == 0 {
                0.0
            } else {
                rng.range(-0.1, 0.1)
            };
        let Some((a, b)) = chord(shape, nucleus, bearing) else {
            continue;
        };
        // Stay on the land side of exact map/water boundaries, within the
        // junction quantization used by the shared street graph.
        let a = point(a, nucleus, (1e-7 / dist(a, nucleus).max(0.03)).min(0.01));
        let b = point(b, nucleus, (1e-7 / dist(b, nucleus).max(0.03)).min(0.01));
        let inherited = |target: Point| {
            if cfg.axis_alignment != "regional" {
                return None;
            }
            let dx = target.x - nucleus.x;
            let dy = target.y - nucleus.y;
            let length = dx.hypot(dy).max(1e-6);
            streets
                .iter()
                .filter(|s| matches!(s.role.as_str(), "regional" | "bridge" | "ford" | "causeway"))
                .filter(|s| {
                    s.path
                        .windows(2)
                        .any(|p| g::distance(nucleus, p[0], p[1]).0 < 3.0)
                })
                .flat_map(|s| &s.path)
                .filter_map(|p| {
                    let x = p.x - nucleus.x;
                    let y = p.y - nucleus.y;
                    let d = x.hypot(y);
                    let cosine = (x * dx + y * dy) / (d * length).max(1e-6);
                    (d > radius * 0.15 && cosine > 0.85)
                        .then_some((y.atan2(x), (d - radius * 0.25).abs()))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|p| p.0)
        };
        let (inherited_a, inherited_b) = (inherited(a), inherited(b));
        let (old_a, old_b) = (inherited_a.is_some(), inherited_b.is_some());
        if old_a && old_b {
            continue;
        }
        let mut a = a;
        let mut b = b;
        if let Some(incoming) = inherited_a.or(inherited_b) {
            let direction = incoming + PI;
            if let Some((left, right)) = chord(shape, nucleus, direction) {
                let along = |p: Point| {
                    (p.x - nucleus.x) * direction.cos() + (p.y - nucleus.y) * direction.sin()
                };
                let target = if along(left) > along(right) {
                    left
                } else {
                    right
                };
                let target = point(
                    target,
                    nucleus,
                    (1e-7 / dist(target, nucleus).max(0.03)).min(0.01),
                );
                if old_a {
                    b = target;
                } else {
                    a = target;
                }
            }
        }
        let sign = if i % 2 == 0 { 1.0 } else { -1.0 };
        let path = if old_a {
            wander(nucleus, b, planner, sign)
        } else if old_b {
            wander(a, nucleus, planner, sign)
        } else {
            wander(a, nucleus, planner, sign).and_then(|mut path| {
                let tail = wander(nucleus, b, planner, -sign)?;
                path.extend(tail.into_iter().skip(1));
                Some(path)
            })
        };
        let Some(path) = path else {
            continue;
        };
        if !inside_path(shape, &path) || !simple_path(&path, false) {
            continue;
        }
        if path
            .iter()
            .all(|&p| nearest(p, streets).is_some_and(|n| n.0 < 2.0))
        {
            continue;
        }
        let width = if old_a || old_b {
            streets
                .iter()
                .filter(|s| s.role == "regional")
                .filter(|s| {
                    s.path
                        .windows(2)
                        .any(|p| g::distance(nucleus, p[0], p[1]).0 < 3.0)
                })
                .flat_map(|s| s.widths.iter().copied())
                .fold(0.0_f64, f64::max)
                .max(2.0)
        } else {
            m.width(if i == 0 { 0 } else { 1 }, rng)
        };
        let street = Street {
            widths: vec![width; path.len()],
            path,
            rank: usize::from(i > 0),
            role: if radial { "radial" } else { "street" }.into(),
        };
        split_by(regions, &street);
        streets.push(street);
    }
    if cfg.rings < 2 || !radial || streets.is_empty() {
        return;
    }
    let mut ring = vec![];
    for i in 0..24 {
        let a = angle + i as f64 * TAU / 24.0;
        let p = Point {
            x: nucleus.x + a.cos() * radius * 0.43,
            y: nucleus.y + a.sin() * radius * 0.43,
        };
        if !g::contains(shape, p) {
            return;
        }
        ring.push(p);
    }
    let mut path = vec![ring[0]];
    for i in 0..ring.len() {
        let Some(part) = planner.route(ring[i], ring[(i + 1) % ring.len()], cfg.max_street_grade)
        else {
            return;
        };
        path.extend(part.into_iter().skip(1));
    }
    if !inside_path(shape, &path) || !simple_path(&path, true) {
        return;
    }
    if !path.windows(2).any(|a| {
        streets.iter().any(|st| {
            st.path
                .windows(2)
                .any(|b| g::segment_hit(a[0], a[1], b[0], b[1]).is_some())
        })
    }) {
        return;
    }
    let inner = g::normalized(Shape {
        outer: path[..path.len() - 1].to_vec(),
        holes: vec![],
    });
    if g::area(&inner) < 100.0 {
        return;
    }
    let mut partition = vec![];
    for region in regions.iter() {
        partition.extend(g::intersection(region, &inner));
        partition.extend(g::difference(region, &inner));
    }
    let before: f64 = regions.iter().map(g::area).sum();
    let after: f64 = partition.iter().map(g::area).sum();
    if (before - after).abs() > before * 1e-6 + 0.01 {
        return;
    }
    *regions = partition;
    let width = m.width(1, rng);
    streets.push(Street {
        widths: vec![width; path.len()],
        path,
        rank: 1,
        role: "ring".into(),
    });
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
    let mut rng = Rng::new(seed).fork("geographic-plan");
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let profile = if cfg.composition == "settlement" {
        profiles::settlement_profile(culture, site.population, cfg.phases)
    } else {
        profiles::profile(culture)
    };
    let pattern_override = cfg.tissue != "culture"
        || cfg.params.get("streetOp").is_some()
        || cfg.preset != "culture"
        || cfg.composition == "settlement" && cfg.recipe != "auto";
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
    if cfg.axis_alignment == "regional"
        && !orientation_override
        && let Some(regional) = regional_axis(c, radius * 1.5, roads)
    {
        angle = regional + cfg.footprint.orientation.to_radians();
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
    let mut streets: Vec<_> = roads.iter().flat_map(|s| clip(s, &envelope)).collect();
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
            warnings.push(
                "Une approche régionale impraticable ne peut pas être raccordée à cette pente."
                    .into(),
            );
        }
    }
    streets = retained;
    for road in &streets {
        split_by(&mut regions, road);
    }
    split_joined_roads(&mut regions, &streets);
    if pattern == "radial" || pattern == "organic" || profile.gates == "cardinal" {
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
    let desired = (cfg.count * cfg.rings).min(256);
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
            let sp = spacing[usize::from(turn != 0.0)];
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
                planner.route(start, end, cfg.max_street_grade)
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
        } else {
            rejected.push(index);
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
    if profile.waterfront {
        add_quay(&regions, &mut streets, surface, cfg, m, &mut rng);
        // A town whose programme has quay services (warehouse, emporium,
        // fish market) gets a landing row behind its quays.
        if super::roles::services(culture, site.population, "auto")
            .iter()
            .any(|n| n.entry.site == "quay")
        {
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
        warnings
            .push("Terrain trop contraint : aucun axe carrossable ne rejoint ce quartier.".into());
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

fn add_quay(
    regions: &[Shape],
    streets: &mut Vec<Street>,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    m: &Morph,
    rng: &mut Rng,
) {
    let offset = (surface.width / surface.n as f64 * 0.1).clamp(3.0, 8.0);
    let mut candidates: Vec<(f64, Vec<Point>, Point, Point)> = vec![];
    for s in regions {
        let first_candidate = candidates.len();
        // The coast is commonly tessellated into sub-metre edges. Its vertex
        // spacing must not determine whether a usable quay is long enough.
        // Straighten only within < 1/4 of the landward setback; every resulting
        // complete path still passes the dry-ground and grade checks below.
        let mut outline = s.outer.clone();
        if let Some(&first) = outline.first() {
            outline.push(first);
        }
        let shoreline = g::simplify(&outline, offset * 0.25, |_| false);
        for edge in shoreline.windows(2) {
            let (a, b) = (edge[0], edge[1]);
            let l = dist(a, b);
            if l < 10.0 {
                continue;
            }
            let normal = Point {
                x: -(b.y - a.y) / l,
                y: (b.x - a.x) / l,
            };
            let shift = |p: Point, d: f64| Point {
                x: p.x + normal.x * d,
                y: p.y + normal.y * d,
            };
            let mid = point(a, b, 0.5);
            let wet_side = shift(mid, -offset);
            if wet_side.x < 0.0
                || wet_side.y < 0.0
                || wet_side.x >= surface.width
                || wet_side.y >= surface.width
            {
                continue;
            }
            let x = (wet_side.x / surface.width * surface.n as f64) as usize;
            let y = (wet_side.y / surface.width * surface.n as f64) as usize;
            if !matches!(surface.water[y * surface.n + x], 1..=3) || surface.wet(shift(mid, offset))
            {
                continue;
            }
            let path = vec![shift(a, offset), shift(b, offset)];
            if routing::path_clear(surface, &path, cfg.max_street_grade.min(0.04)) {
                let p = point(path[0], path[1], 0.5);
                if let Some((d, q, _)) = nearest(p, streets)
                    && d < 80.0
                    && routing::segment_clear(surface, p, q, cfg.max_street_grade)
                {
                    // Adjacent usable reaches form one quay platform. Do not
                    // rank tiny contour segments independently and leave gaps
                    // merely because the contour changed direction slightly.
                    if candidates.len() > first_candidate {
                        let previous = candidates.last_mut().unwrap();
                        let tail = &previous.1[previous.1.len() - 2..];
                        let turn = ((tail[1].x - tail[0].x) * (path[1].x - path[0].x)
                            + (tail[1].y - tail[0].y) * (path[1].y - path[0].y))
                            / (dist(tail[0], tail[1]) * l).max(1e-9);
                        let gap = dist(tail[1], path[0]);
                        if gap <= offset * 2.0
                            && turn >= 0.707
                            && routing::segment_clear(
                                surface,
                                tail[1],
                                path[0],
                                cfg.max_street_grade.min(0.04),
                            )
                        {
                            let length =
                                previous.0 * (1.0 + dist(previous.2, previous.3) * 0.02) + gap + l;
                            if gap > 1e-5 {
                                previous.1.push(path[0]);
                            }
                            previous.1.push(path[1]);
                            if d < dist(previous.2, previous.3) {
                                previous.2 = p;
                                previous.3 = q;
                            }
                            previous.0 = length / (1.0 + dist(previous.2, previous.3) * 0.02);
                            continue;
                        }
                    }
                    candidates.push((l / (1.0 + d * 0.02), path, p, q));
                }
            }
        }
    }
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut accepted = 0;
    for (_, path, p, q) in candidates.into_iter().take(12) {
        // Keep room for the contour simplification error on the seaward side.
        // The whole platform, including inner joins, must stay on dry land;
        // a dry centreline alone is insufficient on an irregular shore.
        let preferred = m.width(1, rng).max(4.0).min(offset * 1.5);
        let Some(width) = [preferred, 4.0].into_iter().find(|&width| {
            g::ribbon(&path, &vec![width; path.len()])
                .iter()
                .all(|ribbon| {
                    let dry_area: f64 = g::dry_clip(&surface, ribbon).iter().map(g::area).sum();
                    g::area(ribbon) - dry_area <= 1e-4
                })
        }) else {
            continue;
        };
        if dist(p, q) > 1.0 {
            streets.push(Street {
                path: vec![p, q],
                widths: vec![4.0; 2],
                rank: 2,
                role: "street".into(),
            });
        }
        streets.push(Street {
            widths: vec![width; path.len()],
            path,
            rank: 1,
            role: "quay".into(),
        });
        accepted += 1;
        if accepted == 4 {
            break;
        }
    }
}

/// Landing row behind each quay: a service lane at warehouse depth, closed on
/// a neighbouring town street or else on the quay ends, so the quay-side strip becomes its own block instead of
/// part of a large coastal block that one warehouse would absorb whole (the
/// programme refuses blocks over four times a facility). The row is sized by
/// the culture's own warehouse admission (frontage x depth of its native
/// witness) and certified before the lane is kept: simple, dry, inside its
/// quarter with usable land left behind it, lane within lane grade and the
/// fall from quay to lane within the admission slope. Otherwise nothing is
/// added and the quay keeps its coastal block.
fn add_landing_rows(
    regions: &[Shape],
    streets: &mut Vec<Street>,
    roads: &[Street],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    m: &Morph,
    culture: &str,
) {
    const LANE: f64 = 4.0;
    let Some(profile) = super::culture::contextual_mapping(
        culture,
        &cfg.programme.period,
        "middle",
        m.text("plotOp"),
        "warehouse",
    )
    .map(|c| c.admissibility) else {
        return;
    };
    let (short, long) = (
        profile.min_frontage.min(profile.min_depth).max(6.0),
        profile.min_frontage.max(profile.min_depth).max(6.0),
    );
    let normal = |a: Point, b: Point| {
        let l = dist(a, b).max(1e-9);
        Point {
            x: -(b.y - a.y) / l,
            y: (b.x - a.x) / l,
        }
    };
    // Quays of one quarter along one shore form one row: consecutive
    // reaches (same heading, gap < one witness) chained in shore order.
    let mut quays: Vec<(usize, Vec<Point>, f64)> = streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
        .filter_map(|s| {
            let mid = point(s.path[0], s.path[1], 0.5);
            let region = regions.iter().position(|r| g::contains(r, mid))?;
            Some((
                region,
                s.path.clone(),
                s.widths.iter().copied().fold(0.0, f64::max),
            ))
        })
        .collect();
    let mut chains: Vec<(usize, Vec<Point>, f64)> = vec![];
    quays.sort_by_key(|q| q.0);
    for region in quays
        .iter()
        .map(|q| q.0)
        .collect::<std::collections::BTreeSet<_>>()
    {
        let mut own: Vec<(Vec<Point>, f64)> = quays
            .iter()
            .filter(|q| q.0 == region)
            .map(|q| (q.1.clone(), q.2))
            .collect();
        let (a, b) = (own[0].0[0], *own[0].0.last().unwrap());
        let l = dist(a, b).max(1e-9);
        let axis = Point {
            x: (b.x - a.x) / l,
            y: (b.y - a.y) / l,
        };
        let along = |p: Point| p.x * axis.x + p.y * axis.y;
        for (path, _) in &mut own {
            if along(*path.last().unwrap()) < along(path[0]) {
                path.reverse();
            }
        }
        own.sort_by(|x, y| along(x.0[0]).total_cmp(&along(y.0[0])));
        for (path, width) in own {
            let heading = |p: &[Point]| {
                let (a, b) = (p[0], p[p.len() - 1]);
                let l = dist(a, b).max(1e-9);
                Point {
                    x: (b.x - a.x) / l,
                    y: (b.y - a.y) / l,
                }
            };
            if let Some(last) = chains.last_mut().filter(|c| {
                c.0 == region && dist(*c.1.last().unwrap(), path[0]) < short && {
                    let (h, k) = (heading(&c.1), heading(&path));
                    h.x * k.x + h.y * k.y >= 0.8
                }
            }) {
                last.1.extend(path);
                last.2 = last.2.max(width);
            } else {
                chains.push((region, path, width));
            }
        }
    }
    for (region, path, width) in chains {
        let region = &regions[region];
        let length: f64 = path.windows(2).map(|w| dist(w[0], w[1])).sum();
        // Clear land between the quay and lane ribbons holds the witness,
        // with a tenth spare for a shore that is not parallel to the lane.
        let depth = long * 1.1 + (width + LANE) * 0.5 + 1.0;
        if length < short + LANE + 1.0 {
            continue;
        }
        let mid = point(path[0], path[1], 0.5);
        let (first, last) = (path[0], path[path.len() - 1]);
        let chord = normal(first, last);
        let n0 = normal(path[0], path[1]);
        let inland = |side: f64| {
            let p = Point {
                x: mid.x + n0.x * side * depth * 0.5,
                y: mid.y + n0.y * side * depth * 0.5,
            };
            g::contains(region, p) && !surface.wet(p)
        };
        let side = if inland(1.0) {
            1.0
        } else if inland(-1.0) {
            -1.0
        } else {
            continue;
        };
        // Mitred parallel of the quay axis (quay reaches turn by < 45°), or
        // a straight lane parallel to the quay's chord on a curved reach.
        let parallel = |d: f64, straight: bool| -> Vec<Point> {
            if straight {
                return [first, last]
                    .iter()
                    .map(|p| Point {
                        x: p.x + chord.x * side * d,
                        y: p.y + chord.y * side * d,
                    })
                    .collect();
            }
            (0..path.len())
                .map(|i| {
                    let a = normal(path[i.saturating_sub(1)], path[i.max(1)]);
                    let b = if i + 1 < path.len() {
                        normal(path[i], path[i + 1])
                    } else {
                        a
                    };
                    let (x, y) = (a.x + b.x, a.y + b.y);
                    let l = x.hypot(y).max(1e-9);
                    let n = Point { x: x / l, y: y / l };
                    let mitre = (n.x * a.x + n.y * a.y).max(0.7);
                    Point {
                        x: path[i].x + n.x * side * d / mitre,
                        y: path[i].y + n.y * side * d / mitre,
                    }
                })
                .collect()
        };
        let fall = profile.max_slope.min(cfg.max_street_grade);
        let grade = cfg.max_lane_grade.max(cfg.max_street_grade);
        let on_quay = |p: Point| path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 1e-6);
        let others: Vec<Street> = streets
            .iter()
            .chain(roads)
            .filter(|s| s.role != "quay" && !(s.path.len() == 2 && on_quay(s.path[0])))
            .cloned()
            .collect();
        // Each lane end returns to its quay end (a leg); where the leg would
        // leave the quarter (a street bounds it there) it closes on that
        // street instead. One leg at least keeps the quay on the network.
        let close = |b: Point, quay_end: Point| {
            if inside_path(region, &[quay_end, b]) {
                return Some((quay_end, true));
            }
            match nearest(b, &others) {
                Some((d, q, _))
                    if d > 0.5
                        && d < depth * 0.6
                        && routing::segment_clear(surface, b, q, grade) =>
                {
                    Some((q, false))
                }
                _ => None,
            }
        };
        for straight in [false, true] {
            let back = parallel(depth, straight);
            let (b0, b1) = (back[0], back[back.len() - 1]);
            let (Some((start, start_leg)), Some((end, end_leg))) =
                (close(b0, first), close(b1, last))
            else {
                continue;
            };
            let mut lane = vec![start];
            lane.extend(back.iter().copied());
            lane.push(end);
            let mut ring = path.clone();
            ring.extend(back.iter().rev().copied());
            let strip = Shape {
                outer: ring,
                holes: vec![],
            };
            let a = g::area(&strip);
            let certified = g::simple(&strip)
                && a >= length * depth * 0.7
                && inside_path(region, &back)
                && (start_leg || end_leg)
                && inside_path(region, &parallel(depth * 1.6, straight))
                && routing::path_clear(surface, &lane, grade)
                && path.iter().chain(&back).all(|&p| {
                    (surface.height_at(p) - surface.height_at(mid)).abs() <= fall * depth
                })
                && g::dry_clip(&surface, &strip)
                    .iter()
                    .map(g::area)
                    .sum::<f64>()
                    >= a * 0.98;
            if !certified {
                continue;
            }
            // The quay's landing street now starts from the lane, so the
            // strip stays one block; a landing that never reaches the lane
            // (a town street inside the strip) leaves the quay without a row.
            let links: Vec<usize> = (0..streets.len())
                .filter(|&i| {
                    let s = &streets[i];
                    s.role == "street" && s.path.len() == 2 && on_quay(s.path[0])
                })
                .collect();
            let mut joins = vec![];
            for &link in &links {
                let (p, q) = (streets[link].path[0], streets[link].path[1]);
                let hit = lane
                    .windows(2)
                    .enumerate()
                    .filter_map(|(k, w)| g::segment_hit(p, q, w[0], w[1]).map(|(t, x)| (k, t, x)))
                    .filter(|&(_, t, _)| t > 1e-6)
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                match hit {
                    Some((k, _, x)) => joins.push((link, k, x)),
                    None => break,
                }
            }
            if joins.len() < links.len() {
                break;
            }
            // Insert the joints from the lane's far end so indices hold.
            joins.sort_by(|a, b| {
                b.1.cmp(&a.1)
                    .then(dist(lane[b.1], b.2).total_cmp(&dist(lane[a.1], a.2)))
            });
            for &(_, k, x) in &joins {
                lane.insert(k + 1, x);
            }
            joins.sort_by(|a, b| b.0.cmp(&a.0));
            for (link, _, x) in joins {
                let q = streets[link].path[1];
                if dist(x, q) > 1.0 {
                    streets[link].path = vec![x, q];
                } else {
                    streets.remove(link);
                }
            }
            // A row lane steeper than street grade is a lane, as in quarters.
            let street = routing::path_clear(surface, &lane, cfg.max_street_grade);
            streets.push(Street {
                widths: vec![LANE; lane.len()],
                path: lane,
                rank: if street { 2 } else { 3 },
                role: if street { "street" } else { "lane" }.into(),
            });
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tessellated_shoreline_keeps_a_connected_dry_quay() {
        let n = 64;
        let height = vec![0.; n * n];
        let water: Vec<u8> = (0..n * n).map(|i| u8::from(i % n < 32)).collect();
        let surface = Surface {
            geometry: None,
            width: 256.,
            n,
            height: &height,
            water: &water,
        };
        let shore = |x| {
            let mut outer = vec![
                Point { x, y: 20. },
                Point { x: 200., y: 20. },
                Point { x: 200., y: 220. },
            ];
            // The real coast is straight but its stored contour has 2 m edges.
            outer.extend((0..=100).map(|i| Point {
                x,
                y: 220. - 2. * i as f64,
            }));
            g::normalized(Shape {
                outer,
                holes: vec![],
            })
        };
        let road = Street {
            path: vec![Point { x: 160., y: 30. }, Point { x: 160., y: 210. }],
            widths: vec![5.; 2],
            rank: 1,
            role: "street".into(),
        };
        let cfg = LayoutConfig::default();
        let morph = Morph {
            value: serde_json::json!({}),
        };
        let mut streets = vec![road.clone()];
        add_quay(
            &[shore(128.)],
            &mut streets,
            surface,
            &cfg,
            &morph,
            &mut Rng::new("quay"),
        );
        let quays: Vec<_> = streets.iter().filter(|s| s.role == "quay").collect();
        assert_eq!(quays.len(), 1);
        assert!(dist(quays[0].path[0], *quays[0].path.last().unwrap()) > 190.);
        assert!(routing::path_clear(surface, &quays[0].path, 0.04));
        for ribbon in g::ribbon(&quays[0].path, &quays[0].widths) {
            assert!(
                g::area(&ribbon)
                    - g::dry_clip(&surface, &ribbon)
                        .iter()
                        .map(g::area)
                        .sum::<f64>()
                    <= 1e-4
            );
        }
        let middle = point(quays[0].path[0], quays[0].path[1], 0.5);
        assert!(
            streets
                .iter()
                .any(|s| s.role == "street" && s.path.contains(&middle))
        );
        let mut inland = vec![road];
        add_quay(
            &[shore(150.)],
            &mut inland,
            surface,
            &cfg,
            &morph,
            &mut Rng::new("quay"),
        );
        assert!(!inland.iter().any(|s| s.role == "quay"));
    }

    #[test]
    fn adjacent_shoreline_reaches_form_one_dry_platform() {
        let n = 256;
        let height = vec![0.; n * n];
        let water: Vec<u8> = (0..n * n)
            .map(|i| {
                let (x, y) = ((i % n) as f64 + 0.5, (i / n) as f64 + 0.5);
                u8::from(x < 128. + 12. * (1. - (y - 120.).abs() / 100.).max(0.))
            })
            .collect();
        let surface = Surface {
            geometry: None,
            width: 256.,
            n,
            height: &height,
            water: &water,
        };
        let shore = g::normalized(Shape {
            outer: vec![
                Point { x: 128., y: 20. },
                Point { x: 200., y: 20. },
                Point { x: 200., y: 220. },
                Point { x: 128., y: 220. },
                Point { x: 140., y: 120. },
            ],
            holes: vec![],
        });
        let mut streets = vec![Street {
            path: vec![Point { x: 160., y: 30. }, Point { x: 160., y: 210. }],
            widths: vec![5.; 2],
            rank: 1,
            role: "street".into(),
        }];
        add_quay(
            &[shore],
            &mut streets,
            surface,
            &LayoutConfig::default(),
            &Morph {
                value: serde_json::json!({}),
            },
            &mut Rng::new("quay-curve"),
        );
        let quays: Vec<_> = streets.iter().filter(|s| s.role == "quay").collect();
        assert_eq!(quays.len(), 1);
        assert!(quays[0].path.len() >= 3);
        assert!(routing::path_clear(surface, &quays[0].path, 0.04));
        assert!(
            quays[0]
                .path
                .windows(2)
                .map(|w| dist(w[0], w[1]))
                .sum::<f64>()
                > 200.
        );
    }

    fn site(culture: &str, population: u32) -> Site {
        Site {
            key: "plan".into(),
            name: String::new(),
            population,
            culture: culture.into(),
            center: Point { x: 256.0, y: 256.0 },
            radius: 120.0,
        }
    }
    fn morph(culture: &str) -> Morph {
        super::super::resolve(
            culture,
            "culture",
            "core",
            "core",
            1.0,
            &serde_json::json!({}),
            "quarters",
        )
        .unwrap()
    }
    #[test]
    fn regional_branches_partition_at_their_shared_nucleus() {
        let mut regions = vec![g::rectangle(0.0, 0.0, 100.0, 100.0)];
        let road = |a: Point| Street {
            path: vec![a, Point { x: 50.0, y: 50.0 }],
            widths: vec![6.0; 2],
            rank: 0,
            role: "road".into(),
        };
        split_joined_roads(
            &mut regions,
            &[
                road(Point { x: 0.0, y: 50.0 }),
                road(Point { x: 100.0, y: 50.0 }),
                road(Point { x: 50.0, y: 100.0 }),
            ],
        );
        assert_eq!(regions.len(), 3);
        assert!((regions.iter().map(g::area).sum::<f64>() - 10000.0).abs() < 0.001);
    }
    #[test]
    fn cultural_walls_radials_and_rings_keep_exact_dry_partition() {
        let heights = vec![0.0; 64 * 64];
        let water = vec![0; 64 * 64];
        let surface = Surface {
            geometry: None,
            width: 512.0,
            n: 64,
            height: &heights,
            water: &water,
        };
        let cfg = LayoutConfig {
            rings: 2,
            ..LayoutConfig::default()
        };
        let m = morph("european-organic");
        let a = generate(
            "radials",
            &site("european-organic", 3000),
            &cfg,
            &m,
            surface,
            &[],
            120.0,
        );
        let b = generate(
            "radials",
            &site("european-organic", 3000),
            &cfg,
            &m,
            surface,
            &[],
            120.0,
        );
        assert_eq!(
            serde_json::to_string(&a.streets).unwrap(),
            serde_json::to_string(&b.streets).unwrap()
        );
        assert_eq!(a.enclosures[0].kind, "wall");
        assert!(
            !a.streets
                .iter()
                .any(|s| matches!(s.role.as_str(), "radial" | "ring"))
        );
        let radial = generate(
            "radials",
            &site("wizard-city", 3000),
            &cfg,
            &morph("wizard-city"),
            surface,
            &[],
            120.0,
        );
        assert!(radial.streets.iter().any(|s| s.role == "radial"));
        assert!(radial.streets.iter().any(|s| s.role == "ring"));
        let envelope = Shape {
            outer: a.enclosures[0].path.clone(),
            holes: vec![],
        };
        assert!(
            (a.quarters.iter().map(|q| g::area(&q.shape)).sum::<f64>() - g::area(&envelope)).abs()
                < 0.01
        );
        for (i, q) in a.quarters.iter().enumerate() {
            for other in &a.quarters[i + 1..] {
                assert!(
                    g::intersection(&q.shape, &other.shape)
                        .iter()
                        .map(g::area)
                        .sum::<f64>()
                        < 0.01
                );
            }
        }
        let small = generate(
            "small",
            &site("norse-ringfort", 300),
            &LayoutConfig::default(),
            &morph("norse-ringfort"),
            surface,
            &[],
            120.0,
        );
        assert_eq!(small.enclosures[0].kind, "palisade");
    }
    #[test]
    fn waterfront_orientation_follows_the_local_bank() {
        let heights = vec![0.0; 64 * 64];
        let mut water = vec![0; 64 * 64];
        for y in 0..64 {
            for x in 40..64 {
                water[y * 64 + x] = 1;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 512.0,
            n: 64,
            height: &heights,
            water: &water,
        };
        let angle = water_angle(surface, Point { x: 250.0, y: 260.0 }, 120.0).unwrap();
        assert!(angle.cos().abs() < 0.01);
    }
}
