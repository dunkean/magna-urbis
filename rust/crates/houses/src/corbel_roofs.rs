//! Physical masonry courses. These faces bypass the upper roof envelope.
use super::*;

pub(super) fn intrados(kind: RoofFaceKind) -> bool {
    matches!(kind, RoofFaceKind::CorbelSoffit | RoofFaceKind::CorbelRiser)
}

/// The true outer pans remain authoritative for attachment/roof intersections.
pub(super) fn cover_references(raw: &[RawFace]) -> Vec<Candidate> {
    raw.iter()
        .filter(|f| {
            f.source.corbel && matches!(f.source.kind, RoofFaceKind::Pan | RoofFaceKind::Slab)
        })
        .map(|f| {
            let mut source = f.source.clone();
            source.domain = surface(
                f.vertices
                    .iter()
                    .map(|v| Point { x: v.x, y: v.y })
                    .collect(),
            );
            source
        })
        .collect()
}

pub(super) fn validate_collisions(
    corbel: &[Candidate],
    ordinary: &[Candidate],
) -> Result<(), String> {
    for a in corbel {
        for b in ordinary
            .iter()
            .filter(|b| b.body_id != a.body_id && b.feature_id.is_none())
        {
            if !overlaps(bounds(&a.domain), bounds(&b.domain)) {
                continue;
            }
            let overlap = intersection(&a.domain, &b.domain);
            if area(&overlap) <= EPS {
                continue;
            }
            let delta = a.plane.minus(b.plane);
            let mut lo = f64::INFINITY;
            let mut hi = f64::NEG_INFINITY;
            for p in overlap.iter().flat_map(|p| &p.outer) {
                let z = delta.height(*p);
                lo = lo.min(z);
                hi = hi.max(z);
            }
            if lo <= 0.001 && hi >= -0.001 {
                return Err(format!(
                    "Encorbellement {} intersectant la couverture {}.",
                    a.body_id, b.body_id
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_spec(source: &RoofSource) -> Result<(), String> {
    let Some(c) = &source.roof_spec.corbel else {
        return Ok(());
    };
    let valid_profile = match c.profile {
        CorbelProfile::Dome => source.roof_system == "RF-DOME",
        CorbelProfile::Barrel => source.roof_system == "RF-FLAT",
    };
    let max_courses = if c.profile == CorbelProfile::Barrel {
        24
    } else {
        64
    };
    if source.feature_id.is_some()
        || !valid_profile
        || source.overhang_m != 0.0
        || source.roof_spec.oculus_ratio != 0.0
        || !(4..=max_courses).contains(&c.courses)
        || [
            (c.rise_m, 0.32, 8.0),
            (c.cap_span_m, 0.2, 2.0),
            (c.cap_thickness_m, 0.08, 1.0),
            (c.min_bearing_m, 0.05, 0.5),
        ]
        .iter()
        .any(|(v, lo, hi)| !v.is_finite() || v < lo || v > hi)
        || c.rise_m / (c.courses as f64) < 0.08 - EPS
    {
        return Err(format!(
            "Profil d'encorbellement incompatible : {}.",
            source.id
        ));
    }
    let catalogue = crate::catalogue::catalogue()?;
    if !catalogue.material_has(&c.material, &["load_bearing"])
        || !catalogue
            .materials
            .iter()
            .any(|m| m.id == c.material && m.pattern == "stone")
    {
        return Err(format!(
            "Encorbellement sans maçonnerie porteuse : {}.",
            source.id
        ));
    }
    Ok(())
}

pub(super) fn estimate(unit: &HouseUnit, source: &RoofSource) -> usize {
    let Some(c) = &source.roof_spec.corbel else {
        return 0;
    };
    let count = c.courses as usize;
    match c.profile {
        CorbelProfile::Dome => source
            .level
            .footprint
            .iter()
            .map(|p| p.outer.len())
            .sum::<usize>()
            .saturating_mul(3 * count + 3),
        CorbelProfile::Barrel => {
            let rooms = unit
                .rooms
                .iter()
                .filter(|r| r.body_id == source.body_id && r.level == source.level.index)
                .count();
            let mut hole_edges = source.level.roof_slab.as_ref().map_or(0, |s| {
                s.surface
                    .iter()
                    .flat_map(|p| &p.holes)
                    .map(Vec::len)
                    .sum::<usize>()
            });
            hole_edges += unit
                .access
                .portals
                .iter()
                .filter(|p| {
                    p.kind == PortalKind::Hatch && (p.to_z_m - source.support_z_m).abs() <= 0.001
                })
                .flat_map(|p| &p.opening_surface)
                .map(|p| p.outer.len())
                .sum::<usize>();
            hole_edges += unit
                .features
                .iter()
                .filter(|f| {
                    f.kind == FeatureKind::Flue
                        && f.z_m <= source.support_z_m
                        && f.z_m + f.height_m >= source.support_z_m - 0.001
                })
                .flat_map(|f| &f.surface)
                .flat_map(|p| &p.holes)
                .map(Vec::len)
                .sum::<usize>();
            rooms.saturating_mul(4 * count + 2 + hole_edges * (count + 4) * 4)
        }
    }
}

fn error(source: &RoofSource, message: &str) -> String {
    format!("Encorbellement {} : {message}.", source.id)
}

fn surface(ring: Vec<Point>) -> Surface {
    vec![Polygon {
        outer: ring,
        holes: vec![],
    }]
}
fn vertex(p: Point, z: f64) -> Vertex3 {
    Vertex3 {
        x: p.x,
        y: p.y,
        z: snap(z),
    }
}

fn emit(raw: &mut Vec<RawFace>, t: &Candidate, kind: RoofFaceKind, vertices: Vec<Vertex3>) {
    let mut source = t.clone();
    source.kind = kind;
    source.corbel = true;
    if let Some(n) = normal(&vertices)
        && n[2].abs() > EPS
    {
        let p = &vertices[0];
        source.plane = Plane {
            a: -n[0] / n[2],
            b: -n[1] / n[2],
            c: p.z + (n[0] * p.x + n[1] * p.y) / n[2],
        };
    }
    raw.push(RawFace { source, vertices });
}

fn horizontal(raw: &mut Vec<RawFace>, t: &Candidate, domain: &Surface, holes: &Surface, z: f64) {
    let cut = if holes.is_empty() {
        domain.clone()
    } else {
        difference(domain, holes)
    };
    for p in cut {
        if p.holes.is_empty() && convex(&p.outer) {
            emit(
                raw,
                t,
                RoofFaceKind::CorbelSoffit,
                p.outer.into_iter().map(|p| vertex(p, z)).collect(),
            );
        } else {
            for triangle in g::to_geo(&vec![p]).0[0].earcut_triangles() {
                emit(
                    raw,
                    t,
                    RoofFaceKind::CorbelSoffit,
                    triangle
                        .to_array()
                        .into_iter()
                        .map(|p| vertex(Point { x: p.x, y: p.y }, z))
                        .collect(),
                );
            }
        }
    }
}

fn convex(ring: &[Point]) -> bool {
    ring.len() >= 3
        && g::signed_area(ring) > EPS
        && (0..ring.len()).all(|i| {
            let a = ring[i];
            let b = ring[(i + 1) % ring.len()];
            let c = ring[(i + 2) % ring.len()];
            (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) >= -1.0e-7
        })
}

/// Every height interval must contain the entire required band of real masonry.
fn bearing(
    unit: &HouseUnit,
    source: &RoofSource,
    band: &Surface,
    bottom: f64,
    top: f64,
) -> Result<(), String> {
    let c = source.roof_spec.corbel.as_ref().unwrap();
    let walls: Vec<_> = unit
        .walls
        .iter()
        .filter(|w| {
            w.body_id.as_ref() == Some(&source.body_id)
                && w.level == source.level.index
                && w.material == c.material
                && !w.shell_reference
                && matches!(
                    w.kind,
                    WallKind::Exterior | WallKind::Interior | WallKind::Party
                )
                && w.centerline.len() >= 2
                && w.z_m + w.height_m > bottom - 0.001
                && w.z_m < top + 0.001
        })
        .collect();
    let mut zs = vec![bottom, top];
    for w in &walls {
        if !w.z_m.is_finite() || !w.height_m.is_finite() || w.height_m <= 0.0 {
            return Err(error(source, "mur porteur non fini"));
        }
        valid_surface(&w.footprint)?;
        zs.extend([
            w.z_m.clamp(bottom, top),
            (w.z_m + w.height_m).clamp(bottom, top),
        ]);
    }
    zs.sort_by(f64::total_cmp);
    zs.dedup();
    for pair in zs.windows(2).filter(|p| p[1] - p[0] > 0.001) {
        let z = (pair[0] + pair[1]) * 0.5;
        let polygons: Vec<_> = walls
            .iter()
            .filter(|w| w.z_m <= z && w.z_m + w.height_m >= z)
            .flat_map(|w| g::to_geo(&crate::wall_geometry::wall_section(w, z)).0)
            .collect();
        let masonry = g::from_geo(&geo::algorithm::bool_ops::unary_union(&polygons));
        if area(&difference(band, &masonry)) > g::area_tolerance(band) {
            return Err(error(
                source,
                "épaisseur ou continuité du mur d'appui insuffisante",
            ));
        }
    }
    if bottom >= top - 0.001 || walls.is_empty() {
        return Err(error(source, "mur d'appui absent"));
    }
    // A lintel is physical even when its upper-wall fragment has no opening_ids.
    for p in &unit.access.portals {
        if matches!(
            p.kind,
            PortalKind::Door | PortalKind::Tunnel | PortalKind::Passage | PortalKind::Gate
        ) && area(&intersection(band, &p.opening_surface)) > EPS
            && p.from_z_m.min(p.to_z_m) < bottom
        {
            let lintel = unit
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::PortalLintel && f.id == format!("lintel:{}", p.id))
                .map_or(0.25, |f| f.height_m);
            if p.head_z_m + lintel > bottom + 0.001 {
                return Err(error(
                    source,
                    "naissance sous la tête de porte et son linteau",
                ));
            }
        }
    }
    for f in &unit.features {
        if f.kind == FeatureKind::Window
            && area(&intersection(band, &f.surface)) > EPS
            && f.z_m < bottom
            && f.z_m + f.height_m + 0.25 > bottom + 0.001
        {
            return Err(error(
                source,
                "naissance sous la tête de fenêtre et son linteau",
            ));
        }
    }
    Ok(())
}

fn conflict(
    unit: &HouseUnit,
    source: &RoofSource,
    domain: &Surface,
    bottom: f64,
    top: f64,
) -> Result<(), String> {
    for body in unit.bodies.iter().filter(|b| b.id != source.body_id) {
        for l in &body.levels {
            if l.z_m < top - 0.001
                && l.z_m + l.height_m > bottom + 0.001
                && area(&intersection(domain, &l.footprint)) > g::area_tolerance(domain)
            {
                return Err(error(source, "intersection avec un autre volume bâti"));
            }
        }
    }
    Ok(())
}

pub(super) fn build(
    unit: &HouseUnit,
    source: &RoofSource,
    t: &Candidate,
    domain: &Surface,
    raw: &mut Vec<RawFace>,
    groups: &mut BTreeMap<String, RoofGroup>,
) -> Result<(), String> {
    let body = unit
        .bodies
        .iter()
        .find(|b| b.id == source.body_id)
        .ok_or_else(|| error(source, "corps absent"))?;
    if body.levels.len() != 1 {
        return Err(error(source, "profil réservé au plain-pied"));
    }
    match source.roof_spec.corbel.as_ref().unwrap().profile {
        CorbelProfile::Dome => dome(unit, source, body, t, domain, raw, groups),
        CorbelProfile::Barrel => barrel(unit, source, t, domain, raw, groups),
    }
}

fn group(source: &RoofSource, t: &Candidate, room: Option<String>, domain: Surface) -> RoofGroup {
    RoofGroup {
        id: t.group.clone(),
        rf: source.roof_system.clone(),
        body_id: source.body_id.clone(),
        feature_id: None,
        room_id: room,
        level: source.level.index,
        domain,
    }
}

fn dome(
    unit: &HouseUnit,
    source: &RoofSource,
    body: &Body,
    t: &Candidate,
    domain: &Surface,
    raw: &mut Vec<RawFace>,
    groups: &mut BTreeMap<String, RoofGroup>,
) -> Result<(), String> {
    let c = source.roof_spec.corbel.as_ref().unwrap();
    if domain.len() != 1
        || !domain[0].holes.is_empty()
        || !convex(&domain[0].outer)
        || area(&difference(&source.level.footprint, domain)) > g::area_tolerance(domain)
    {
        return Err(error(
            source,
            "dôme exigeant une emprise convexe intacte sans vide",
        ));
    }
    let cavity = g::offset(domain, -body.wall_thickness_m);
    if cavity.len() != 1 || !cavity[0].holes.is_empty() || !convex(&cavity[0].outer) {
        return Err(error(source, "cavité du dôme invalide"));
    }
    let center = g::center(domain);
    let outer = &domain[0].outer;
    let inner: Vec<_> = outer
        .iter()
        .map(|p| {
            ray_ring(center, *p, &cavity[0].outer)
                .ok_or_else(|| error(source, "anneau intérieur non radial"))
        })
        .collect::<Result<_, _>>()?;
    let radius = |p: &Point| libm::hypot(p.x - center.x, p.y - center.y);
    let r_inner = inner.iter().map(radius).fold(0.0, f64::max);
    let inner_final = c.cap_span_m * 0.5 / r_inner;
    let outer_final = outer
        .iter()
        .zip(&inner)
        .map(|(o, i)| (radius(i) * inner_final + c.min_bearing_m) / radius(o))
        .fold(0.0, f64::max);
    if inner_final >= 1.0 || outer_final >= 1.0 {
        return Err(error(source, "cap trop large pour le dôme"));
    }
    let spring = source.support_z_m;
    let cap_z = spring + c.rise_m;
    let top = cap_z + c.cap_thickness_m;
    let height = c.rise_m / c.courses as f64;
    let base_band = difference(domain, &cavity);
    bearing(unit, source, &base_band, spring - c.min_bearing_m, spring)?;
    conflict(unit, source, domain, spring, top)?;
    let mut t = t.clone();
    t.group = format!("{}:corbel:dome", t.group);
    t.material = c.material.clone();
    t.corbel = true;
    let scaled = |ring: &[Point], fraction: f64| -> Vec<Point> {
        ring.iter()
            .map(|p| Point {
                x: center.x + (p.x - center.x) * fraction,
                y: center.y + (p.y - center.y) * fraction,
            })
            .collect()
    };
    for k in 0..c.courses {
        let a = k as f64 / c.courses as f64;
        let b = (k + 1) as f64 / c.courses as f64;
        let oi = scaled(outer, 1.0 + (outer_final - 1.0) * a);
        let on = scaled(outer, 1.0 + (outer_final - 1.0) * b);
        let ii = scaled(&inner, 1.0 + (inner_final - 1.0) * a);
        let inn = scaled(&inner, 1.0 + (inner_final - 1.0) * b);
        let z = spring + k as f64 * height;
        for i in 0..outer.len() {
            let j = (i + 1) % outer.len();
            let retreat = libm::hypot(ii[i].x - inn[i].x, ii[i].y - inn[i].y);
            let band_width = |p: Point, ring: &[Point]| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                    .map(|(a, b)| distance_to_segment(p, *a, *b))
                    .fold(f64::INFINITY, f64::min)
            };
            let overlap = band_width(ii[i], &oi);
            let thickness = band_width(inn[i], &on);
            if retreat > height + 0.001
                || overlap < c.min_bearing_m - 0.001
                || thickness < c.min_bearing_m - 0.001
            {
                return Err(error(
                    source,
                    "retrait ou recouvrement d'assise du dôme insuffisant",
                ));
            }
            emit(
                raw,
                &t,
                RoofFaceKind::Pan,
                vec![
                    vertex(oi[i], z),
                    vertex(oi[j], z),
                    vertex(on[j], z + height),
                    vertex(on[i], z + height),
                ],
            );
            emit(
                raw,
                &t,
                RoofFaceKind::CorbelSoffit,
                vec![
                    vertex(ii[i], z),
                    vertex(ii[j], z),
                    vertex(inn[j], z),
                    vertex(inn[i], z),
                ],
            );
            // Clockwise normal points into the enclosed cavity.
            emit(
                raw,
                &t,
                RoofFaceKind::CorbelRiser,
                vec![
                    vertex(inn[j], z),
                    vertex(inn[i], z),
                    vertex(inn[i], z + height),
                    vertex(inn[j], z + height),
                ],
            );
        }
    }
    let cap_inner = scaled(&inner, inner_final);
    let cap_outer = scaled(outer, outer_final);
    horizontal(raw, &t, &surface(cap_inner), &vec![], cap_z);
    emit(
        raw,
        &t,
        RoofFaceKind::Slab,
        cap_outer.iter().map(|p| vertex(*p, top)).collect(),
    );
    for i in 0..cap_outer.len() {
        let j = (i + 1) % cap_outer.len();
        emit(
            raw,
            &t,
            RoofFaceKind::CorbelRiser,
            vec![
                vertex(cap_outer[i], cap_z),
                vertex(cap_outer[j], cap_z),
                vertex(cap_outer[j], top),
                vertex(cap_outer[i], top),
            ],
        );
    }
    groups.insert(t.group.clone(), group(source, &t, None, domain.clone()));
    Ok(())
}

fn ray_ring(center: Point, outer: Point, ring: &[Point]) -> Option<Point> {
    let dx = outer.x - center.x;
    let dy = outer.y - center.y;
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .filter_map(|(a, b)| {
            let ex = b.x - a.x;
            let ey = b.y - a.y;
            let den = dx * ey - dy * ex;
            if den.abs() < EPS {
                return None;
            }
            let ax = a.x - center.x;
            let ay = a.y - center.y;
            let t = (ax * ey - ay * ex) / den;
            let u = (ax * dy - ay * dx) / den;
            (t > 0.0 && (-EPS..=1.0 + EPS).contains(&u)).then_some((
                t,
                Point {
                    x: center.x + t * dx,
                    y: center.y + t * dy,
                },
            ))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, p)| p)
}

fn room_arm(room: &Room, source: &RoofSource) -> Result<RoofArm, String> {
    if room.floor.len() != 1 || !room.floor[0].holes.is_empty() || !convex(&room.floor[0].outer) {
        return Err(error(source, "pièce non rectangulaire sous voûte"));
    }
    let ring = &room.floor[0].outer;
    let (a, b) = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .max_by(|(a, b), (c, d)| {
            ((b.x - a.x).powi(2) + (b.y - a.y).powi(2))
                .total_cmp(&((d.x - c.x).powi(2) + (d.y - c.y).powi(2)))
        })
        .unwrap();
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    let mut arm = RoofArm {
        origin: *a,
        axis: [(b.x - a.x) / length, (b.y - a.y) / length],
        length_m: 0.0,
        width_m: 0.0,
        domain: room.floor.clone(),
    };
    let uv: Vec<_> = ring.iter().map(|p| coordinates(&arm, *p)).collect();
    let xmin = uv.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let xmax = uv.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let ymin = uv.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let ymax = uv.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    arm.origin = local(&arm, xmin, ymin);
    arm.length_m = xmax - xmin;
    arm.width_m = ymax - ymin;
    if arm.width_m > arm.length_m {
        arm = RoofArm {
            origin: local(&arm, arm.length_m, 0.0),
            axis: [-arm.axis[1], arm.axis[0]],
            length_m: arm.width_m,
            width_m: arm.length_m,
            domain: arm.domain,
        };
    }
    let rect = local_surface(&arm, 0.0, 0.0, arm.length_m, arm.width_m);
    if area(&difference(&rect, &room.floor)) + area(&difference(&room.floor, &rect))
        > g::area_tolerance(&room.floor)
    {
        return Err(error(source, "pièce non rectangulaire sous voûte"));
    }
    Ok(arm)
}

fn barrel(
    unit: &HouseUnit,
    source: &RoofSource,
    t: &Candidate,
    domain: &Surface,
    raw: &mut Vec<RawFace>,
    groups: &mut BTreeMap<String, RoofGroup>,
) -> Result<(), String> {
    let c = source.roof_spec.corbel.as_ref().unwrap();
    let slab = source
        .level
        .roof_slab
        .as_ref()
        .ok_or_else(|| error(source, "dalle supérieure absente"))?;
    if (slab.z_m - source.support_z_m).abs() > 0.001 {
        return Err(error(source, "cote de terrasse incohérente"));
    }
    let cap_z = slab.z_m - c.cap_thickness_m;
    let spring = cap_z - c.rise_m;
    let height = c.rise_m / c.courses as f64;
    if spring < source.level.z_m + 2.25 {
        return Err(error(source, "hauteur intérieure insuffisante"));
    }
    let outer: Surface = slab
        .surface
        .iter()
        .map(|p| Polygon {
            outer: p.outer.clone(),
            holes: vec![],
        })
        .collect();
    let mut holes = vec![];
    for p in &slab.surface {
        for ring in &p.holes {
            let mut r = ring.clone();
            r.reverse();
            holes.extend(surface(r));
        }
    }
    for portal in unit
        .access
        .portals
        .iter()
        .filter(|p| p.kind == PortalKind::Hatch && (p.to_z_m - slab.z_m).abs() <= 0.001)
    {
        valid_surface(&portal.opening_surface)?;
        holes.extend(portal.opening_surface.clone());
    }
    for flue in unit.features.iter().filter(|f| {
        f.kind == FeatureKind::Flue && f.z_m <= cap_z && f.z_m + f.height_m >= slab.z_m - 0.001
    }) {
        valid_surface(&flue.surface)?;
        for polygon in &flue.surface {
            for ring in &polygon.holes {
                let mut r = ring.clone();
                r.reverse();
                holes.extend(surface(r));
            }
        }
    }
    if !holes.is_empty() {
        holes = g::from_geo(&geo::algorithm::bool_ops::unary_union(&g::to_geo(&holes).0));
    }
    let mut rooms: Vec<_> = unit
        .rooms
        .iter()
        .filter(|r| r.body_id == source.body_id && r.level == source.level.index)
        .collect();
    rooms.sort_by(|a, b| a.id.cmp(&b.id));
    if rooms.is_empty() {
        return Err(error(source, "aucune pièce pour la voûte"));
    }
    for room in rooms {
        let arm = room_arm(room, source)?;
        if area(&difference(&room.floor, &outer)) > g::area_tolerance(&room.floor)
            || area(&difference(&difference(&room.floor, &holes), domain))
                > g::area_tolerance(&room.floor)
        {
            return Err(error(source, "pièce hors de la dalle de couverture"));
        }
        let retreat = (arm.width_m - c.cap_span_m) * 0.5;
        if retreat <= EPS || retreat / c.courses as f64 > height + 0.001 {
            return Err(error(
                source,
                "retrait d'assise de voûte excessif ou cap trop large",
            ));
        }
        let left = local_surface(
            &arm,
            0.0,
            -retreat - c.min_bearing_m,
            arm.length_m,
            retreat + c.min_bearing_m,
        );
        let right = local_surface(
            &arm,
            0.0,
            arm.width_m,
            arm.length_m,
            retreat + c.min_bearing_m,
        );
        let band = union(&left, &right);
        bearing(unit, source, &band, spring, slab.z_m)?;
        conflict(unit, source, &room.floor, spring, slab.z_m)?;
        let step = retreat / c.courses as f64;
        let first = union(
            &local_surface(&arm, 0.0, 0.0, arm.length_m, step),
            &local_surface(&arm, 0.0, arm.width_m - step, arm.length_m, step),
        );
        let wells = intersection(&room.floor, &holes);
        if area(&intersection(&first, &wells)) > EPS {
            return Err(error(source, "puits coupant l'assise de départ"));
        }
        let mut rt = t.clone();
        rt.group = format!("{}:corbel:{}", t.group, room.id);
        rt.material = c.material.clone();
        rt.corbel = true;
        for k in 0..c.courses {
            let y = k as f64 * step;
            let yn = (k + 1) as f64 * step;
            let z = spring + k as f64 * height;
            let ledges = union(
                &local_surface(&arm, 0.0, y, arm.length_m, step),
                &local_surface(&arm, 0.0, arm.width_m - yn, arm.length_m, step),
            );
            horizontal(raw, &rt, &ledges, &wells, z);
            for (yv, reverse) in [(yn, true), (arm.width_m - yn, false)] {
                let a = local(&arm, 0.0, yv);
                let b = local(&arm, arm.length_m, yv);
                let mut vertices = vec![
                    vertex(a, z),
                    vertex(b, z),
                    vertex(b, z + height),
                    vertex(a, z + height),
                ];
                if reverse {
                    vertices.reverse();
                }
                cut_riser(raw, &rt, vertices, &wells)?;
            }
            let course_solid = union(
                &local_surface(&arm, 0.0, 0.0, arm.length_m, yn),
                &local_surface(&arm, 0.0, arm.width_m - yn, arm.length_m, yn),
            );
            well_walls(raw, &rt, &wells, &course_solid, z, z + height);
        }
        let cap = local_surface(&arm, 0.0, retreat, arm.length_m, c.cap_span_m);
        horizontal(raw, &rt, &cap, &wells, cap_z);
        well_walls(raw, &rt, &wells, &room.floor, cap_z, slab.z_m);
        groups.insert(
            rt.group.clone(),
            group(source, &rt, Some(room.id.clone()), room.floor.clone()),
        );
    }
    Ok(())
}

/// Split a planar vertical riser by authoritative vertical well intervals.
fn cut_riser(
    raw: &mut Vec<RawFace>,
    t: &Candidate,
    vertices: Vec<Vertex3>,
    holes: &Surface,
) -> Result<(), String> {
    if holes.is_empty() {
        emit(raw, t, RoofFaceKind::CorbelRiser, vertices);
        return Ok(());
    }
    let a = Point {
        x: vertices[0].x,
        y: vertices[0].y,
    };
    let b = Point {
        x: vertices[1].x,
        y: vertices[1].y,
    };
    let len = libm::hypot(b.x - a.x, b.y - a.y);
    let axis = [(b.x - a.x) / len, (b.y - a.y) / len];
    let intervals: Vec<_> = line_intervals(a, b, holes)
        .into_iter()
        .map(|(lo, hi)| (lo * len, hi * len))
        .collect();
    let z0 = vertices.iter().map(|v| v.z).fold(f64::INFINITY, f64::min);
    let z1 = vertices
        .iter()
        .map(|v| v.z)
        .fold(f64::NEG_INFINITY, f64::max);
    let original = normal(&vertices).unwrap();
    let mut start = 0.0;
    for (lo, hi) in intervals.into_iter().chain(std::iter::once((len, len))) {
        if lo - start > 0.0001 {
            let p = Point {
                x: a.x + axis[0] * start,
                y: a.y + axis[1] * start,
            };
            let q = Point {
                x: a.x + axis[0] * lo,
                y: a.y + axis[1] * lo,
            };
            let mut v = vec![vertex(p, z0), vertex(q, z0), vertex(q, z1), vertex(p, z1)];
            if normal(&v).is_some_and(|n| n[0] * original[0] + n[1] * original[1] < 0.0) {
                v.reverse();
            }
            emit(raw, t, RoofFaceKind::CorbelRiser, v);
        }
        start = start.max(hi);
    }
    Ok(())
}

fn well_walls(
    raw: &mut Vec<RawFace>,
    t: &Candidate,
    wells: &Surface,
    solid: &Surface,
    z0: f64,
    z1: f64,
) {
    for p in wells {
        for (a, b) in p
            .outer
            .iter()
            .zip(p.outer.iter().cycle().skip(1))
            .take(p.outer.len())
        {
            for (lo, hi) in line_intervals(*a, *b, solid) {
                let start = Point {
                    x: a.x + (b.x - a.x) * lo,
                    y: a.y + (b.y - a.y) * lo,
                };
                let end = Point {
                    x: a.x + (b.x - a.x) * hi,
                    y: a.y + (b.y - a.y) * hi,
                };
                let mut v = vec![
                    vertex(end, z0),
                    vertex(start, z0),
                    vertex(start, z1),
                    vertex(end, z1),
                ];
                // The well polygon is positive; reversed walls point into its void.
                if g::signed_area(&p.outer) < 0.0 {
                    v.reverse();
                }
                emit(raw, t, RoofFaceKind::CorbelRiser, v);
            }
        }
    }
}

/// Finite analytic segment intersections avoid snapping a thin clipping strip.
pub(super) fn line_intervals(a: Point, b: Point, domain: &Surface) -> Vec<(f64, f64)> {
    use geo::{Contains, Intersects};
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let mut ts = vec![0.0, 1.0];
    for ring in domain
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
    {
        for (p, q) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let ex = q.x - p.x;
            let ey = q.y - p.y;
            let den = dx * ey - dy * ex;
            if den.abs() > EPS {
                let px = p.x - a.x;
                let py = p.y - a.y;
                let t = (px * ey - py * ex) / den;
                let u = (px * dy - py * dx) / den;
                if (-EPS..=1.0 + EPS).contains(&t) && (-EPS..=1.0 + EPS).contains(&u) {
                    ts.push(t.clamp(0.0, 1.0));
                }
            } else if (dx * (p.y - a.y) - dy * (p.x - a.x)).abs() < 1e-7 {
                let den = dx * dx + dy * dy;
                ts.extend(
                    [
                        ((p.x - a.x) * dx + (p.y - a.y) * dy) / den,
                        ((q.x - a.x) * dx + (q.y - a.y) * dy) / den,
                    ]
                    .into_iter()
                    .filter(|t| (-EPS..=1.0 + EPS).contains(t))
                    .map(|t| t.clamp(0.0, 1.0)),
                );
            }
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.dedup_by(|a, b| (*a - *b).abs() < EPS);
    let geometry = g::to_geo(domain);
    ts.windows(2)
        .filter(|p| p[1] - p[0] > EPS)
        .filter_map(|p| {
            let t = (p[0] + p[1]) * 0.5;
            let midpoint = geo::Point::new(a.x + dx * t, a.y + dy * t);
            (geometry.contains(&midpoint) || geometry.intersects(&midpoint)).then_some((p[0], p[1]))
        })
        .collect()
}
