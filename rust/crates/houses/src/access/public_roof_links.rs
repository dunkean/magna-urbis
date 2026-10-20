//! Short, supported links between real public roof slabs. Wall and slab
//! apertures are material cuts, recorded by the ordinary portal and wall ids.
use super::*;
use geo::{Intersects, LineString};
use std::collections::BTreeMap;

const TERMINAL_AREA: f64 = 0.85 * WIDTH * 0.35;

pub(super) fn bands(f: &Feature) -> (Surface, Surface) {
    let v = &f.vertices3d;
    let low = [point(v[0].x, v[0].y), point(v[1].x, v[1].y)];
    let high = [point(v[3].x, v[3].y), point(v[2].x, v[2].y)];
    (end_band(low, high, 0.35), end_band(high, low, 0.35))
}

pub(super) fn low_band(f: &Feature) -> Option<Surface> {
    (f.kind == FeatureKind::Ladder && f.vertices3d.len() == 4).then(|| bands(f).0)
}

/// The low slab remains structural; only this native flight occupies its node.
pub(super) fn occupation(unit: &HouseUnit, node: &AccessNode) -> Result<Surface, String> {
    let mut occupied = vec![];
    let mut low_bands = vec![];
    for p in unit
        .access
        .portals
        .iter()
        .filter(|p| p.from == node.id && p.feature_ids.iter().any(|id| id.ends_with(":link:0")))
    {
        let prefix = format!("{}:portal:", unit.id);
        let serial =
            p.id.strip_prefix(&prefix)
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or("Occupation sans portail natif exact.")?;
        let id = format!("{}:public-roof:{serial}:link:0", unit.id);
        let features: Vec<_> = unit.features.iter().filter(|f| f.id == id).collect();
        let targets: Vec<_> = unit.access.nodes.iter().filter(|n| n.id == p.to).collect();
        if p.kind != PortalKind::Ladder
            || p.feature_ids != [id.clone()]
            || unit
                .access
                .portals
                .iter()
                .filter(|other| other.id == p.id)
                .count()
                != 1
            || features.len() != 1
            || targets.len() != 1
            || unit
                .access
                .portals
                .iter()
                .filter(|other| other.feature_ids.contains(&id))
                .count()
                != 1
            || features[0].kind != FeatureKind::Ladder
            || features[0].vertices3d.len() != 4
            || (p.from_z_m - node.z_m).abs() > 1e-9
            || (p.to_z_m - targets[0].z_m).abs() > 1e-9
        {
            return Err("Occupation sans liaison Ladder native unique.".into());
        }
        let f = features[0];
        let mut expected =
            planned_flight(f.surface.clone(), &node.floor, node.z_m, targets[0].z_m)?;
        expected.id = id;
        let opening = [
            point(f.vertices3d[0].x, f.vertices3d[0].y),
            point(f.vertices3d[1].x, f.vertices3d[1].y),
        ];
        let clear = flight_clear(f);
        let (low, _) = bands(f);
        if f != &expected
            || p.opening != opening
            || p.passage != f.surface
            || p.opening_surface != clear
            || (p.width_m - WIDTH).abs() > 1e-9
            || area(&intersection(&low, &clear)) > AREA_EPS
            || area(&intersection(&low, &node.floor)) < TERMINAL_AREA
        {
            return Err("Occupation sans géométrie complète de liaison native.".into());
        }
        validate_occupation_sources(unit, node, &clear, &low)?;
        validate(unit, f, p, true)?;
        low_bands.push(low);
        occupied = union(&occupied, &clear);
    }
    if low_bands
        .iter()
        .any(|low| area(&intersection(low, &occupied)) > AREA_EPS)
    {
        return Err("Occupation empiétant sur une bande basse native.".into());
    }
    Ok(occupied)
}

fn validate_occupation_sources(
    unit: &HouseUnit,
    node: &AccessNode,
    occupation: &Surface,
    low: &Surface,
) -> Result<(), String> {
    let key = libm::round(node.z_m * 1000.0) as i64;
    let mut sources = BTreeSet::new();
    for body in &unit.bodies {
        if unit.bodies.iter().filter(|b| b.id == body.id).count() != 1
            || body
                .levels
                .iter()
                .enumerate()
                .any(|(p, l)| l.index != p as u32)
        {
            return Err("Occupation sans niveaux natifs uniques dans leur ordre.".into());
        }
        for (p, level) in body.levels.iter().enumerate() {
            let Some(slab) = &level.roof_slab else {
                continue;
            };
            if !slab.walkable || libm::round(slab.z_m * 1000.0) as i64 != key {
                continue;
            }
            let upper = body
                .levels
                .get(p + 1)
                .map(|l| l.footprint.clone())
                .unwrap_or_default();
            let exposed = crate::engine::exposed_roof_domain(&level.footprint, &upper);
            let q = intersection(&exposed, occupation);
            if area(&q) <= AREA_EPS {
                continue;
            }
            let id = format!("terrace:{}:{p}", body.id);
            let terraces: Vec<_> = unit.features.iter().filter(|f| f.id == id).collect();
            if libm::round(slab.z_m * 1000.0) as i64
                != libm::round(snap(level.z_m + level.height_m) * 1000.0) as i64
                || terraces.len() != 1
                || terraces[0].kind != FeatureKind::Terrace
                || (terraces[0].z_m - slab.z_m).abs() > 1e-9
                || (terraces[0].height_m - 0.15).abs() > 1e-9
                || terraces[0].material != level.materials.cladding
                || area(&difference(&slab.surface, &exposed)) > AREA_EPS
                || area(&difference(&terraces[0].surface, &exposed)) > AREA_EPS
                || area(&difference(&q, &slab.surface)) > AREA_EPS
                || area(&difference(&q, &terraces[0].surface)) > AREA_EPS
            {
                return Err(
                    "Occupation sans toiture porteuse native intacte sous la liaison.".into(),
                );
            }
            sources.insert(body.id.clone());
        }
    }
    if !sources.is_empty() && !bodies_at(unit, node.z_m, low).is_subset(&sources) {
        return Err("Occupation sans ses sources natives de bande basse.".into());
    }
    Ok(())
}

fn interior(ring: &[Point], i: usize) -> Option<Point> {
    let p = ring[i];
    let a = ring[(i + ring.len() - 1) % ring.len()];
    let b = ring[(i + 1) % ring.len()];
    let la = libm::hypot(a.x - p.x, a.y - p.y);
    let lb = libm::hypot(b.x - p.x, b.y - p.y);
    if la <= GRID_M || lb <= GRID_M {
        return None;
    }
    let v = Point {
        x: (a.x - p.x) / la + (b.x - p.x) / lb,
        y: (a.y - p.y) / la + (b.y - p.y) / lb,
    };
    let l = libm::hypot(v.x, v.y);
    (l > 1e-9).then_some(Point {
        x: v.x / l,
        y: v.y / l,
    })
}

fn footprint(q: Point, u: Point, n: Point, shift: f64) -> Surface {
    let at = |s: f64, t: f64| {
        point(
            q.x + u.x * s + n.x * (t + shift),
            q.y + u.y * s + n.y * (t + shift),
        )
    };
    quad([
        at(-RUN * 0.5, -WIDTH * 0.5),
        at(-RUN * 0.5, WIDTH * 0.5),
        at(RUN * 0.5, WIDTH * 0.5),
        at(RUN * 0.5, -WIDTH * 0.5),
    ])
}

/// The finite separating axes of the native footprint and each actual
/// obstacle supply the transverse candidates. Every candidate is subsequently
/// tested on its rounded polygons and real volumes.
fn shifts(unit: &HouseUnit, q: Point, n: Point, foot: &Surface) -> Vec<f64> {
    let mut out = vec![0.0];
    let obstacles = unit
        .access
        .portals
        .iter()
        .map(|p| &p.passage)
        .chain(unit.features.iter().map(|f| &f.surface))
        .chain(unit.site_context.iter().map(|f| &f.surface));
    for obstacle in obstacles {
        if area(&intersection(foot, obstacle)) <= AREA_EPS {
            continue;
        }
        for ring in rings(foot).chain(rings(obstacle)) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                let l = libm::hypot(b.x - a.x, b.y - a.y);
                if l <= GRID_M {
                    continue;
                }
                let axis = Point {
                    x: (a.y - b.y) / l,
                    y: (b.x - a.x) / l,
                };
                let denominator = axis.x * n.x + axis.y * n.y;
                if denominator.abs() < 1e-9 {
                    continue;
                }
                let range = |s: &Surface| {
                    rings(s)
                        .flatten()
                        .map(|p| (p.x - q.x) * axis.x + (p.y - q.y) * axis.y)
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| {
                            (a.min(v), b.max(v))
                        })
                };
                let (fa, fb) = range(foot);
                let (oa, ob) = range(obstacle);
                for delta in [(oa - fb) / denominator, (ob - fa) / denominator] {
                    let sign = if delta < 0.0 { -1.0 } else { 1.0 };
                    let shift = sign * libm::ceil((delta.abs() + GRID_M) / GRID_M) * GRID_M;
                    if shift.abs() <= WIDTH * 0.5 {
                        out.push(shift);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.abs().total_cmp(&b.abs()).then(a.total_cmp(b)));
    out.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    out
}

pub(super) fn add_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    for base in bases
        .iter()
        .filter(|n| n.kind == AccessKind::Terrace && n.household_id.is_none())
    {
        let dz = target.z_m - base.z_m;
        if dz <= CONTACT || dz > 3.001 || dz * 0.35 / RUN > 0.15 + 1e-9 {
            continue;
        }
        for a in &base.floor {
            for (i, &p) in a.outer.iter().enumerate() {
                let Some(inside_a) = interior(&a.outer, i) else {
                    continue;
                };
                for b in &target.floor {
                    for (j, &r) in b.outer.iter().enumerate() {
                        if libm::hypot(r.x - p.x, r.y - p.y) > GRID_M {
                            continue;
                        }
                        let Some(inside_b) = interior(&b.outer, j) else {
                            continue;
                        };
                        if inside_a.x * inside_b.x + inside_a.y * inside_b.y > -0.9 {
                            continue;
                        }
                        let l = libm::hypot(inside_b.x - inside_a.x, inside_b.y - inside_a.y);
                        let u = Point {
                            x: (inside_b.x - inside_a.x) / l,
                            y: (inside_b.y - inside_a.y) / l,
                        };
                        let n = Point { x: -u.y, y: u.x };
                        let q = point((p.x + r.x) * 0.5, (p.y + r.y) * 0.5);
                        let foot = footprint(q, u, n, 0.0);
                        for shift in shifts(unit, q, n, &foot) {
                            let foot = footprint(q, u, n, shift);
                            let flight = planned_flight(foot, &base.floor, base.z_m, target.z_m)?;
                            let (low, high) = bands(&flight);
                            if area(&intersection(&low, &base.floor)) < TERMINAL_AREA
                                || area(&intersection(&high, &target.floor)) < TERMINAL_AREA
                                || area(&difference(&flight.surface, &unit.lot)) > AREA_EPS
                            {
                                continue;
                            }
                            let mut candidate = unit.clone();
                            if install(&mut candidate, base, target, flight).is_err()
                                || validate_geometry(&candidate, false).is_err()
                            {
                                continue;
                            }
                            *unit = candidate;
                            return Ok(true);
                        }
                    }
                }
            }
        }
    }
    Ok(false)
}

fn min_plane(f: &Feature, s: &Surface) -> Result<f64, String> {
    let mut min = f64::INFINITY;
    for p in s {
        let vertices: Vec<_> = p
            .outer
            .iter()
            .map(|p| Vertex3 {
                x: p.x,
                y: p.y,
                z: plane_z(f, *p),
            })
            .collect();
        for v in bridge::clip(&vertices, &flight_clear(f))? {
            min = min.min(v.z);
        }
    }
    if min.is_finite() {
        Ok(min)
    } else {
        Err("Liaison de terrasse sans section matérielle de coupe.".into())
    }
}

fn install(
    unit: &mut HouseUnit,
    base: &AccessNode,
    target: &AccessNode,
    mut flight: Feature,
) -> Result<(), String> {
    let clear = flight_clear(&flight);
    if unit
        .rooms
        .iter()
        .any(|r| area(&intersection(&clear, &r.floor)) > AREA_EPS)
        || unit
            .access
            .nodes
            .iter()
            .any(|n| n.household_id.is_some() && area(&intersection(&clear, &n.floor)) > AREA_EPS)
    {
        return Err("Liaison publique dans un espace privé.".into());
    }
    let id = interface(
        unit,
        FeatureKind::Ladder,
        flight.surface.clone(),
        base.z_m,
        target.z_m,
    );
    let tagged = format!(
        "{}:public-roof:{}:link:0",
        unit.id,
        unit.access.portals.len()
    );
    unit.features.iter_mut().find(|f| f.id == id).unwrap().id = tagged.clone();
    let opening = [
        point(flight.vertices3d[0].x, flight.vertices3d[0].y),
        point(flight.vertices3d[1].x, flight.vertices3d[1].y),
    ];
    portal(
        unit,
        &base.id,
        &target.id,
        PortalKind::Ladder,
        opening,
        flight.surface.clone(),
        WIDTH,
        vec![tagged.clone()],
    )?;
    flight = unit
        .features
        .iter()
        .find(|f| f.id == tagged)
        .unwrap()
        .clone();
    let portal_id = unit.access.portals.last().unwrap().id.clone();
    let mut pieces = vec![];
    let mut source_id = None;
    for w in &mut unit.walls {
        if area(&intersection(&clear, &w.footprint)) <= AREA_EPS {
            continue;
        }
        let sill = min_plane(&flight, &w.footprint)?;
        if w.z_m + w.height_m <= sill + 1e-9 {
            continue;
        }
        if w.party || w.shell_reference || w.solid.is_some() {
            return Err("Liaison dans un mur mitoyen, une coque ou un solide sans provenance de coupe complète.".into());
        }
        source_id.get_or_insert(w.id.clone());
        pieces.extend(crate::wall_geometry::cut_profile_wall(
            w,
            &clear,
            opening,
            WIDTH,
            WIDTH,
            sill,
            target.z_m + 2.05,
            &portal_id,
        )?);
    }
    unit.walls.retain(|w| !w.footprint.is_empty());
    unit.walls.extend(pieces);
    let p = unit.access.portals.last_mut().unwrap();
    p.opening_surface = clear.clone();
    p.wall_id = source_id;
    if let Some(n) = unit.access.nodes.iter_mut().find(|n| n.id == base.id) {
        n.floor = difference(&n.floor, &clear);
    }
    trim_walk_plane(unit, target.z_m, &clear);
    let p = unit.access.portals.last().unwrap().clone();
    let (low, high) = bands(&flight);
    let base_bodies = bodies_at(unit, base.z_m, &low);
    let target_bodies = bodies_at(unit, target.z_m, &high);
    let cuts = timber::prepare(unit, &flight, &p, &base_bodies, &target_bodies)?;
    // Only the reconstructed native bands necessary for this aperture may
    // be ignored during this pre-certificate. The stored candidate is cloned
    // by the caller, so every failed material operation remains atomic.
    validate_impl(unit, &flight, &p, false, &timber::ignored(unit, &cuts))?;
    timber::apply(unit, cuts, &p.id);
    Ok(())
}

fn bodies_at(unit: &HouseUnit, z: f64, band: &Surface) -> BTreeSet<String> {
    unit.bodies
        .iter()
        .filter(|b| {
            b.levels.iter().any(|l| {
                l.roof_slab.as_ref().is_some_and(|s| {
                    (s.z_m - z).abs() < 1e-9
                        && area(&intersection(&s.surface, band)) >= TERMINAL_AREA
                })
            })
        })
        .map(|b| b.id.clone())
        .collect()
}

fn range_delta(f: &Feature, vertices: &[Vertex3]) -> (f64, f64) {
    vertices
        .iter()
        .map(|v| v.z - plane_z(f, Point { x: v.x, y: v.y }))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), z| {
            (a.min(z), b.max(z))
        })
}

fn wall_range(w: &Wall, f: &Feature, clear: &Surface) -> Result<(f64, f64), String> {
    let mut vertices = vec![];
    if let Some(s) = &w.solid {
        for face in &s.faces {
            let points = face
                .iter()
                .map(|&i| {
                    s.vertices
                        .get(i as usize)
                        .cloned()
                        .ok_or("Liaison : indice de mur invalide.")
                })
                .collect::<Result<Vec<_>, _>>()?;
            vertices.extend(bridge::clip(&points, clear)?);
        }
    } else {
        for p in &w.footprint {
            for z in [w.z_m, w.z_m + w.height_m] {
                let points = p
                    .outer
                    .iter()
                    .map(|p| Vertex3 { x: p.x, y: p.y, z })
                    .collect::<Vec<_>>();
                vertices.extend(bridge::clip(&points, clear)?);
            }
        }
    }
    Ok(range_delta(f, &vertices))
}

pub(super) fn recorded_cuts(
    unit: &HouseUnit,
    f: &Feature,
    p: &Portal,
    clear: &Surface,
) -> Result<Surface, String> {
    let marker = format!(":{}:volume:", p.id);
    let mut masks = vec![];
    for piece in &unit.walls {
        let Some((source_id, suffix)) = piece.id.split_once(&marker) else {
            continue;
        };
        let source = unit
            .walls
            .iter()
            .find(|w| w.id == source_id)
            .ok_or("Liaison sans source prismatique conservée de sa coupe.")?;
        if suffix.parse::<usize>().is_err()
            || piece.solid.is_none()
            || source.solid.is_some()
            || source.party
            || source.shell_reference
            || !source.opening_ids.contains(&p.id)
            || source.body_id != piece.body_id
            || source.level != piece.level
            || source.material != piece.material
            || source.centerline != piece.centerline
            || area(&intersection(&source.footprint, clear)) > AREA_EPS
            || wall_range(piece, f, clear)?.1 > 1e-9
        {
            return Err(
                "Liaison sans provenance complète de mur prismatique coupé sous le plan.".into(),
            );
        }
        masks.push(piece.footprint.clone());
    }
    Ok(intersection(&unite(&masks), &p.opening_surface))
}

fn volume_clear(
    unit: &HouseUnit,
    f: &Feature,
    p: &Portal,
    clear: &Surface,
    base_bodies: &BTreeSet<String>,
    target_bodies: &BTreeSet<String>,
    ignored_bands: &BTreeSet<String>,
) -> Result<(), String> {
    if unit
        .rooms
        .iter()
        .any(|r| area(&intersection(clear, &r.floor)) > AREA_EPS)
        || unit
            .access
            .nodes
            .iter()
            .any(|n| n.household_id.is_some() && area(&intersection(clear, &n.floor)) > AREA_EPS)
    {
        return Err("Liaison publique dans un espace privé.".into());
    }
    let cut_masks = recorded_cuts(unit, f, p, clear)?;
    let (low, high) = bands(f);
    for b in &unit.bodies {
        for l in &b.levels {
            let overlap = intersection(clear, &l.footprint);
            if area(&overlap) <= AREA_EPS {
                continue;
            }
            let below = rings(&overlap)
                .flatten()
                .all(|q| l.z_m + l.height_m <= plane_z(f, *q) + 1e-9);
            if !(below && base_bodies.contains(&b.id))
                && area(&difference(
                    &overlap,
                    &intersection(&cut_masks, &p.opening_surface),
                )) > AREA_EPS
            {
                return Err("Liaison dans un corps sans coupe matérielle enregistrée.".into());
            }
            if let Some(s) = &l.roof_slab {
                let overlap = intersection(clear, &s.surface);
                if area(&overlap) > AREA_EPS
                    && !(base_bodies.contains(&b.id)
                        && rings(&overlap)
                            .flatten()
                            .all(|q| s.z_m <= plane_z(f, *q) + 1e-9))
                {
                    return Err("Liaison sous une dalle non ouverte.".into());
                }
            }
        }
        for (band, upper) in [(&low, false), (&high, true)] {
            for l in &b.levels {
                let overlap = intersection(band, &l.footprint);
                if area(&overlap) <= AREA_EPS {
                    continue;
                }
                let top: Vec<_> = rings(&overlap)
                    .flatten()
                    .map(|q| Vertex3 {
                        x: q.x,
                        y: q.y,
                        z: l.z_m + l.height_m,
                    })
                    .collect();
                let bottom: Vec<_> = top
                    .iter()
                    .map(|v| Vertex3 {
                        z: l.z_m,
                        ..v.clone()
                    })
                    .collect();
                let (min_top, max_top) = range_delta(f, &top);
                let (min, _) = range_delta(f, &bottom);
                if max_top <= -0.15 + CONTACT || min >= 2.05 - CONTACT {
                    continue;
                }
                let native_base = !upper && base_bodies.contains(&b.id) && max_top <= 1e-9;
                let native_high = upper
                    && target_bodies.contains(&b.id)
                    && b.levels.last().is_some_and(|last| last.index == l.index)
                    && (l.z_m + l.height_m - p.to_z_m).abs() < 1e-9
                    && min_top >= -1e-9
                    && max_top <= 0.15 + 1e-9;
                if !(native_base || native_high) {
                    return Err(
                        "Liaison dans un niveau de corps au terminal sans assise native.".into(),
                    );
                }
            }
        }
    }
    for w in &unit.walls {
        for (region, upper) in [(clear, false), (&low, false), (&high, true)] {
            if area(&intersection(region, &w.footprint)) <= AREA_EPS {
                continue;
            }
            let (min, max) = wall_range(w, f, region)?;
            let own_base = w
                .body_id
                .as_ref()
                .is_some_and(|id| base_bodies.contains(id));
            let cut = std::ptr::eq(region, clear) && w.id.contains(&format!(":{}:volume:", p.id));
            let native_high = upper
                && w.body_id
                    .as_ref()
                    .is_some_and(|id| target_bodies.contains(id))
                && !w.party
                && !w.shell_reference
                && !w.id.contains(":volume:")
                && (w.z_m + w.height_m - p.to_z_m).abs() < 1e-9
                && area(&difference(&intersection(&w.footprint, &f.surface), &high)) <= AREA_EPS
                && (-1e-9..=0.15 + 1e-9).contains(&max);
            if max > -0.15 + CONTACT
                && min < 2.05 - CONTACT
                && !((own_base || cut) && max <= 1e-9 || native_high)
            {
                return Err(format!("Liaison publique dans le volume du mur {}.", w.id));
            }
        }
    }
    for other in unit.features.iter().chain(&unit.site_context) {
        if other.id == f.id
            || ignored_bands.contains(&other.id)
            || area(&intersection(&f.surface, &other.surface)) <= AREA_EPS
        {
            continue;
        }
        let (min, max) = if matches!(other.kind, FeatureKind::Stair | FeatureKind::Ladder)
            && other.vertices3d.len() == 4
        {
            range_delta(f, &bridge::clip(&other.vertices3d, &f.surface)?)
        } else {
            let (a, b) = if matches!(
                other.kind,
                FeatureKind::Landing
                    | FeatureKind::Terrace
                    | FeatureKind::Deck
                    | FeatureKind::Gallery
            ) {
                (other.z_m - other.height_m, other.z_m)
            } else {
                (other.z_m, other.z_m + other.height_m)
            };
            let overlap = intersection(&f.surface, &other.surface);
            let vertices = rings(&overlap)
                .flatten()
                .flat_map(|q| {
                    [
                        Vertex3 {
                            x: q.x,
                            y: q.y,
                            z: a,
                        },
                        Vertex3 {
                            x: q.x,
                            y: q.y,
                            z: b,
                        },
                    ]
                })
                .collect::<Vec<_>>();
            range_delta(f, &vertices)
        };
        let own_base = other.kind == FeatureKind::Terrace
            && base_bodies
                .iter()
                .any(|id| other.id.starts_with(&format!("terrace:{id}:")));
        let own_high = other.kind == FeatureKind::Terrace
            && target_bodies
                .iter()
                .any(|id| other.id.starts_with(&format!("terrace:{id}:")))
            && (other.z_m - p.to_z_m).abs() < 1e-9
            && area(&difference(
                &intersection(&other.surface, &f.surface),
                &high,
            )) <= AREA_EPS
            && (-1e-9..=0.15 + 1e-9).contains(&max);
        let blocks = matches!(
            other.kind,
            FeatureKind::Landing
                | FeatureKind::Terrace
                | FeatureKind::Deck
                | FeatureKind::Gallery
                | FeatureKind::Neighbor
                | FeatureKind::RockFace
                | FeatureKind::Post
                | FeatureKind::Pier
                | FeatureKind::Stair
                | FeatureKind::Ladder
                | FeatureKind::DecorativeWall
                | FeatureKind::Parapet
                | FeatureKind::Enclosure
                | FeatureKind::Fence
                | FeatureKind::Beam
                | FeatureKind::Frame
                | FeatureKind::RoofDrum
                | FeatureKind::RoofPavilion
                | FeatureKind::RoofDrain
                | FeatureKind::Drain
                | FeatureKind::Flue
                | FeatureKind::Windcatcher
        );
        if blocks
            && max > -0.15 + CONTACT
            && min < 2.05 - CONTACT
            && !(own_base && max <= 1e-9 || own_high)
        {
            return Err(format!("Liaison publique dans {}.", other.id));
        }
    }
    Ok(())
}

fn roof_clear(
    unit: &HouseUnit,
    f: &Feature,
    portal: &Portal,
    low: &Surface,
    high: &Surface,
    base_bodies: &BTreeSet<String>,
    target_bodies: &BTreeSet<String>,
) -> Result<(), String> {
    let mut low_slabs = vec![];
    let mut high_slabs = vec![];
    let mut jambs = BTreeMap::new();
    for (face_index, face) in unit.roofs.faces.iter().enumerate() {
        let vertices = face
            .vertices
            .iter()
            .map(|&i| {
                unit.roofs
                    .vertices
                    .get(i as usize)
                    .cloned()
                    .ok_or("Liaison : indice de toiture invalide.")
            })
            .collect::<Result<Vec<_>, _>>()?;
        if face.normal[2].abs() < 1e-6 {
            let (min, max) = range_delta(f, &vertices);
            if max > -0.15 + CONTACT && min < 2.05 - CONTACT {
                for (edge, (a, b)) in vertices
                    .iter()
                    .zip(vertices.iter().cycle().skip(1))
                    .take(vertices.len())
                    .enumerate()
                {
                    let line = LineString::from(vec![(a.x, a.y), (b.x, b.y)]);
                    if !to_geo(&f.surface).intersects(&line) {
                        continue;
                    }
                    if face.kind != RoofFaceKind::Parapet {
                        return Err("Liaison dans un parapet ou une face verticale.".into());
                    }
                    if !jambs.contains_key(&face.roof_group) {
                        let (band, z) = if base_bodies.contains(&face.body_id) {
                            (low, portal.from_z_m)
                        } else if target_bodies.contains(&face.body_id) {
                            (high, portal.to_z_m)
                        } else {
                            return Err("Liaison dans un parapet étranger.".into());
                        };
                        let certificate = crate::roofs::parapet_jamb_edges(
                            unit,
                            portal,
                            band,
                            z,
                            &face.roof_group,
                        )
                        .map_err(|e| format!("Liaison dans un parapet non certifié : {e}"))?;
                        jambs.insert(face.roof_group.clone(), certificate);
                    }
                    if !jambs[&face.roof_group].contains(&(face_index, edge)) {
                        return Err("Liaison dans un parapet ou une face verticale.".into());
                    }
                }
            }
            continue;
        }
        let overlap = bridge::clip(&vertices, &f.surface)?;
        if overlap.len() < 3 {
            continue;
        }
        let projection = vec![Polygon {
            outer: overlap.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
            holes: vec![],
        }];
        if area(&projection) <= AREA_EPS {
            continue;
        }
        if face.kind == RoofFaceKind::Slab {
            if overlap
                .iter()
                .all(|v| (v.z - f.vertices3d[0].z).abs() < 1e-9)
            {
                low_slabs.push(intersection(&projection, low));
            }
            if overlap
                .iter()
                .all(|v| (v.z - f.vertices3d[2].z).abs() < 1e-9)
            {
                high_slabs.push(intersection(&projection, high));
            }
        }
        let (min, max) = range_delta(f, &overlap);
        let base = base_bodies.contains(&face.body_id) && max <= 1e-9;
        let target = target_bodies.contains(&face.body_id)
            && face.kind == RoofFaceKind::Slab
            && area(&difference(&projection, high)) <= AREA_EPS
            && min >= -1e-9
            && max <= 0.15 + 1e-9;
        if max > -0.15 + CONTACT && min < 2.05 - CONTACT && !(base || target) {
            return Err("Liaison dans une toiture non ouverte.".into());
        }
    }
    if area(&unite(&low_slabs)) < TERMINAL_AREA || area(&unite(&high_slabs)) < TERMINAL_AREA {
        return Err("Liaison sans les deux dalles natives de terminal.".into());
    }
    Ok(())
}

pub(super) fn validate(
    unit: &HouseUnit,
    f: &Feature,
    p: &Portal,
    check_roofs: bool,
) -> Result<(), String> {
    validate_impl(unit, f, p, check_roofs, &BTreeSet::new())
}

fn validate_impl(
    unit: &HouseUnit,
    f: &Feature,
    p: &Portal,
    check_roofs: bool,
    ignored_bands: &BTreeSet<String>,
) -> Result<(), String> {
    let a = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == p.from)
        .ok_or("Liaison sans départ.")?;
    let b = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == p.to)
        .ok_or("Liaison sans arrivée.")?;
    if a.kind != AccessKind::Terrace
        || b.kind != AccessKind::Terrace
        || a.household_id.is_some()
        || b.household_id.is_some()
        || f.vertices3d.len() != 4
        || p.to_z_m <= p.from_z_m + CONTACT
    {
        return Err("Liaison sans deux terrasses publiques.".into());
    }
    let v = &f.vertices3d;
    let run = libm::hypot(v[2].x - v[1].x, v[2].y - v[1].y);
    if p.to_z_m - p.from_z_m > 3.001 || (p.to_z_m - p.from_z_m) * 0.35 / run > 0.15 + 1e-9 {
        return Err("Liaison hors de l'assise de son terminal haut.".into());
    }
    let (low, high) = bands(f);
    if area(&intersection(&low, &a.floor)) < TERMINAL_AREA
        || area(&intersection(&high, &b.floor)) < TERMINAL_AREA
        || area(&difference(&f.surface, &unit.lot)) > AREA_EPS
    {
        return Err("Liaison sans terminaux réellement portés.".into());
    }
    let base_bodies = bodies_at(unit, a.z_m, &low);
    let target_bodies = bodies_at(unit, b.z_m, &high);
    if base_bodies.is_empty() || target_bodies.is_empty() {
        return Err("Liaison sans deux dalles structurelles.".into());
    }
    if !base_bodies.is_disjoint(&target_bodies) {
        return Err("Liaison dont les deux terminaux appartiennent au même corps.".into());
    }
    let clear = flight_clear(f);
    volume_clear(
        unit,
        f,
        p,
        &clear,
        &base_bodies,
        &target_bodies,
        ignored_bands,
    )?;
    if check_roofs {
        roof_clear(unit, f, p, &low, &high, &base_bodies, &target_bodies)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "public_roof_links_tests.rs"]
mod tests;

#[cfg(test)]
pub(super) fn install_fixture_link(
    unit: &mut HouseUnit,
    base: &AccessNode,
    target: &AccessNode,
    corner: Point,
    tangent: Point,
) -> Result<(), String> {
    let n = Point {
        x: -tangent.y,
        y: tangent.x,
    };
    let f = planned_flight(
        footprint(corner, tangent, n, 0.0),
        &base.floor,
        base.z_m,
        target.z_m,
    )?;
    install(unit, base, target, f)
}

#[cfg(test)]
pub(super) fn occupation_fixture() -> HouseUnit {
    let mut unit = tests::linked();
    crate::roofs::build_roofs(&mut unit).unwrap();
    unit
}
