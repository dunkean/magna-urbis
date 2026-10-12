//! Concentric meridional shells. Local convex material cells provide true
//! opening caps; their interfaces are never exported as exposed roof faces.
use super::*;

pub(super) fn oriented(kind: RoofFaceKind) -> bool {
    matches!(
        kind,
        RoofFaceKind::ShellOuter
            | RoofFaceKind::ShellInner
            | RoofFaceKind::ShellRib
            | RoofFaceKind::ShellRibEnd
            | RoofFaceKind::ShellJamb
            | RoofFaceKind::ShellLintel
    )
}

pub(super) fn validate_spec(source: &RoofSource) -> Result<(), String> {
    let Some(shell) = &source.roof_spec.shell else {
        return Ok(());
    };
    let rib = [shell.rib_width_m, shell.rib_depth_m, shell.rib_spacing_m];
    let none = rib.iter().all(|v| *v == 0.0);
    if source.roof_system != "RF-SHELL"
        || source.envelope != Envelope::Shell
        || source.feature_id.is_some()
        || source.intermediate
        || rib.iter().any(|v| !v.is_finite() || *v < 0.0)
        || (!none
            && (shell.rib_width_m < 0.04
                || shell.rib_depth_m < 0.02
                || shell.rib_spacing_m < 0.25
                || shell.rib_width_m >= shell.rib_spacing_m))
        || (shell.profile == ShellProfile::Round && !none)
        || (shell.profile == ShellProfile::Ogival
            && (source.overhang_m != 0.0
                || source.roof_spec.oculus_ratio != 0.0
                || !source.voids.is_empty()))
    {
        return Err(format!(
            "Profil/nervures de coque incompatibles : {}.",
            source.id
        ));
    }
    let catalogue = crate::catalogue::catalogue()?;
    if !none
        && (!catalogue.material_has(&shell.material, &["load_bearing"])
            || shell.material != source.level.materials.infill)
    {
        return Err(format!(
            "Matière de nervure incompatible avec la coque : {}.",
            source.id
        ));
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct CutPlane {
    n: [f64; 3],
    c: f64,
    kind: RoofFaceKind,
}
impl CutPlane {
    fn eval(self, v: &Vertex3) -> f64 {
        self.n[0] * v.x + self.n[1] * v.y + self.n[2] * v.z + self.c
    }
    fn opposite(self) -> Self {
        Self {
            n: self.n.map(|x| -x),
            c: -self.c,
            ..self
        }
    }
}
#[derive(Clone)]
struct CellFace {
    vertices: Vec<Vertex3>,
    kind: Option<RoofFaceKind>,
    exposure: Vec<CutPlane>,
}
type Cell = Vec<CellFace>;
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn length(a: [f64; 3]) -> f64 {
    libm::sqrt(dot(a, a))
}
fn cmp(a: &Vertex3, b: &Vertex3) -> std::cmp::Ordering {
    a.x.total_cmp(&b.x)
        .then(a.y.total_cmp(&b.y))
        .then(a.z.total_cmp(&b.z))
}
fn close(a: &Vertex3, b: &Vertex3) -> bool {
    (a.x - b.x).abs() + (a.y - b.y).abs() + (a.z - b.z).abs() < 1e-8
}
fn clean(mut v: Vec<Vertex3>) -> Vec<Vertex3> {
    v.dedup_by(|a, b| close(a, b));
    if v.len() > 1 && close(&v[0], v.last().unwrap()) {
        v.pop();
    }
    v
}
fn polygon_clip(vertices: &[Vertex3], plane: CutPlane) -> Vec<Vertex3> {
    let mut out = vec![];
    for (a, b) in vertices
        .iter()
        .zip(vertices.iter().cycle().skip(1))
        .take(vertices.len())
    {
        let da = plane.eval(a);
        let db = plane.eval(b);
        if da >= -1e-9 {
            out.push(a.clone());
        }
        if (da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9) {
            // Shared edges are evaluated in canonical order on both neighbors.
            let (p, q) = if cmp(a, b).is_le() { (a, b) } else { (b, a) };
            let dp = plane.eval(p);
            let dq = plane.eval(q);
            let f = dp / (dp - dq);
            out.push(Vertex3 {
                x: p.x + (q.x - p.x) * f,
                y: p.y + (q.y - p.y) * f,
                z: p.z + (q.z - p.z) * f,
            });
        }
    }
    clean(out)
}

/// Keep n·p+c≥0 in a convex cell and close its material with an outward cap.
fn clip_cell(cell: &Cell, plane: CutPlane, cap_kind: Option<RoofFaceKind>) -> Option<Cell> {
    let values: Vec<_> = cell
        .iter()
        .flat_map(|f| &f.vertices)
        .map(|v| plane.eval(v))
        .collect();
    // A face on the partition plane has no material volume on the discarded
    // side. Keeping it as a second cell would export the same interface twice.
    if values.iter().all(|v| *v <= 1e-9) {
        return None;
    }
    if cell
        .iter()
        .flat_map(|f| &f.vertices)
        .all(|v| plane.eval(v) < -1e-9)
    {
        return None;
    }
    if cell
        .iter()
        .flat_map(|f| &f.vertices)
        .all(|v| plane.eval(v) >= -1e-9)
    {
        return Some(cell.clone());
    }
    let mut out = vec![];
    let mut cap = vec![];
    for face in cell {
        let clipped = polygon_clip(&face.vertices, plane);
        for v in &clipped {
            if plane.eval(v).abs() < 1e-7 && !cap.iter().any(|p| close(p, v)) {
                cap.push(v.clone());
            }
        }
        if normal(&clipped).is_some() {
            out.push(CellFace {
                vertices: clipped,
                kind: face.kind,
                exposure: face.exposure.clone(),
            });
        }
    }
    if cap.len() >= 3 {
        let norm = length(plane.n);
        let outward = plane.n.map(|x| -x / norm);
        let seed = if outward[2].abs() < 0.8 {
            [0.0, 0.0, 1.0]
        } else {
            [1.0, 0.0, 0.0]
        };
        let e1 = cross(seed, outward);
        let l = length(e1);
        let e1 = e1.map(|x| x / l);
        let e2 = cross(outward, e1);
        let center = [
            cap.iter().map(|p| p.x).sum::<f64>() / cap.len() as f64,
            cap.iter().map(|p| p.y).sum::<f64>() / cap.len() as f64,
            cap.iter().map(|p| p.z).sum::<f64>() / cap.len() as f64,
        ];
        cap.sort_by(|a, b| {
            let angle = |v: &Vertex3| {
                let d = [v.x - center[0], v.y - center[1], v.z - center[2]];
                libm::atan2(dot(d, e2), dot(d, e1))
            };
            angle(a).total_cmp(&angle(b)).then_with(|| cmp(a, b))
        });
        if normal(&cap).is_some() {
            out.push(CellFace {
                vertices: cap,
                kind: cap_kind,
                exposure: vec![],
            });
        }
    }
    (!out.is_empty()).then_some(out)
}

fn carve(cell: Cell, planes: &[CutPlane]) -> Vec<Cell> {
    // A disjoint prism cannot expose any part of this material cell. Avoid
    // extending its side partitions into the uncut apex and neighboring ribs.
    if planes.iter().any(|plane| {
        cell.iter()
            .flat_map(|face| &face.vertices)
            .all(|vertex| plane.eval(vertex) <= 1e-9)
    }) {
        return vec![cell];
    }
    let mut remaining = Some(cell);
    let mut out = vec![];
    for &plane in planes {
        let Some(current) = remaining else {
            break;
        };
        if let Some(mut outside) = clip_cell(&current, plane.opposite(), Some(plane.kind)) {
            // A BSP cap outside a later opening plane is an internal interface.
            // Only the part within the complete opening prism is exposed.
            for face in &mut outside {
                if face.kind == Some(plane.kind)
                    && face.vertices.iter().all(|v| plane.eval(v).abs() < 1e-7)
                {
                    face.exposure.extend_from_slice(planes);
                }
            }
            out.push(outside);
        }
        remaining = clip_cell(&current, plane, None);
    }
    out
}

fn portal_planes(portal: &Portal) -> Result<Vec<CutPlane>, String> {
    let [a, b] = portal.opening;
    let len = libm::sqrt((b.x - a.x).powi(2) + (b.y - a.y).powi(2));
    if len < 0.05 {
        return Err(format!("Axe de passage de coque invalide : {}.", portal.id));
    }
    let tangent = [(b.x - a.x) / len, (b.y - a.y) / len];
    let normal = [-tangent[1], tangent[0]];
    let center = Point {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
    };
    let depth: Vec<_> = portal
        .opening_surface
        .iter()
        .chain(&portal.passage)
        .flat_map(|p| &p.outer)
        .map(|p| normal[0] * p.x + normal[1] * p.y)
        .collect();
    let lo = depth.iter().copied().fold(f64::INFINITY, f64::min) - 0.002;
    let hi = depth.iter().copied().fold(f64::NEG_INFINITY, f64::max) + 0.002;
    let bottom = portal
        .sill_z_m
        .unwrap_or(portal.from_z_m.min(portal.to_z_m));
    let top = portal.head_z_m;
    let width = portal.width_m;
    let top_width = portal.top_width_m.unwrap_or(width);
    if !bottom.is_finite()
        || !top_width.is_finite()
        || bottom >= top
        || top_width <= 0.0
        || !lo.is_finite()
        || !hi.is_finite()
    {
        return Err(format!(
            "Prisme de passage de coque invalide : {}.",
            portal.id
        ));
    }
    let slope = (top_width - width) * 0.5 / (top - bottom);
    let u = tangent[0] * center.x + tangent[1] * center.y;
    Ok(vec![
        CutPlane {
            n: [tangent[0], tangent[1], slope],
            c: -u + width * 0.5 - slope * bottom,
            kind: RoofFaceKind::ShellJamb,
        },
        CutPlane {
            n: [-tangent[0], -tangent[1], slope],
            c: u + width * 0.5 - slope * bottom,
            kind: RoofFaceKind::ShellJamb,
        },
        CutPlane {
            n: [normal[0], normal[1], 0.0],
            c: -lo,
            kind: RoofFaceKind::ShellJamb,
        },
        CutPlane {
            n: [-normal[0], -normal[1], 0.0],
            c: hi,
            kind: RoofFaceKind::ShellJamb,
        },
        CutPlane {
            n: [0.0, 0.0, 1.0],
            c: -bottom,
            kind: RoofFaceKind::ShellJamb,
        },
        CutPlane {
            n: [0.0, 0.0, -1.0],
            c: top,
            kind: RoofFaceKind::ShellLintel,
        },
    ])
}

fn make_cell(outer: [Vertex3; 4], inner: [Vertex3; 4], kinds: [Option<RoofFaceKind>; 6]) -> Cell {
    let [a, b, c, d] = outer;
    let [e, f, g, h] = inner;
    [
        vec![a.clone(), b.clone(), c.clone(), d.clone()],
        vec![e.clone(), h.clone(), g.clone(), f.clone()],
        vec![a.clone(), d.clone(), h.clone(), e.clone()],
        vec![b.clone(), f.clone(), g.clone(), c.clone()],
        vec![a, e, f, b],
        vec![d, c, g, h],
    ]
    .into_iter()
    .zip(kinds)
    .filter_map(|(v, kind)| {
        let v = clean(v);
        normal(&v).map(|_| CellFace {
            vertices: v,
            kind,
            exposure: vec![],
        })
    })
    .collect()
}

fn radius_on_ray(ring: &[Point], center: Point, angle: f64) -> Result<f64, String> {
    let d = [libm::cos(angle), libm::sin(angle)];
    let mut radius = f64::INFINITY;
    for (a, b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let e = [b.x - a.x, b.y - a.y];
        let den = d[0] * e[1] - d[1] * e[0];
        if den.abs() < 1e-12 {
            continue;
        }
        let p = [a.x - center.x, a.y - center.y];
        let r = (p[0] * e[1] - p[1] * e[0]) / den;
        let u = (p[0] * d[1] - p[1] * d[0]) / den;
        if r > 0.0 && (-1e-9..=1.0 + 1e-9).contains(&u) {
            radius = radius.min(r);
        }
    }
    if radius.is_finite() {
        Ok(radius)
    } else {
        Err("Contour de coque non étoilé.".into())
    }
}

pub(super) fn build(
    unit: &HouseUnit,
    source: &RoofSource,
    template: &Candidate,
    domain: &Surface,
    raw: &mut Vec<RawFace>,
    groups: &mut BTreeMap<String, RoofGroup>,
) -> Result<(), String> {
    let shell = source.roof_spec.shell.as_ref().unwrap();
    let body = unit.bodies.iter().find(|b| b.id == source.body_id).unwrap();
    let [arm] = source.roof_arms.as_slice() else {
        return Err(format!(
            "Coque ogivale exige un bras unique : {}.",
            source.id
        ));
    };
    let [polygon] = source.level.footprint.as_slice() else {
        return Err("Coque ogivale exige une emprise connexe.".into());
    };
    if !polygon.holes.is_empty()
        || body.levels.len() != 1
        || body.wall_thickness_m <= 0.0
        || shell.rib_depth_m >= body.wall_thickness_m
        || area(&difference(&source.level.footprint, domain)) > g::area_tolerance(domain)
    {
        return Err(format!(
            "Emprise/épaisseur de coque incompatible : {}.",
            source.id
        ));
    }
    let b = bounds(&source.level.footprint);
    let center = Point {
        x: (b[0] + b[2]) * 0.5,
        y: (b[1] + b[3]) * 0.5,
    };
    let arm_center = local(arm, arm.length_m * 0.5, arm.width_m * 0.5);
    if libm::hypot(center.x - arm_center.x, center.y - arm_center.y) > 0.002 {
        return Err("Repère de coque non centré sur son emprise.".into());
    }
    let radii: Vec<_> = polygon
        .outer
        .iter()
        .map(|p| libm::sqrt((p.x - center.x).powi(2) + (p.y - center.y).powi(2)))
        .collect();
    let circle_radius = radii.iter().sum::<f64>() / radii.len() as f64;
    if radii.iter().any(|r| (r - circle_radius).abs() > 0.001) {
        return Err(format!(
            "Diamètre circulaire de coque non déclaré : {}.",
            source.id
        ));
    }
    let ring = &polygon.outer;
    let mut inradii = vec![];
    let mut order = 0.0;
    for (a, b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let len = libm::sqrt((b.x - a.x).powi(2) + (b.y - a.y).powi(2));
        inradii.push(((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)).abs() / len);
        let alpha = libm::atan2(a.y - center.y, a.x - center.x);
        let beta = libm::atan2(b.y - center.y, b.x - center.x);
        let delta = (beta - alpha).rem_euclid(TAU);
        if delta <= 1e-10 || delta >= PI {
            return Err("Ordre polaire de coque invalide.".into());
        }
        order += delta;
    }
    let a = inradii.iter().copied().fold(f64::INFINITY, f64::min);
    let mean_inradius = inradii.iter().sum::<f64>() / inradii.len() as f64;
    if (order - TAU).abs() > 1e-7 || inradii.iter().any(|r| (r - mean_inradius).abs() > 0.001) {
        return Err("Contour circulaire de coque irrégulier.".into());
    }
    let thickness = body.wall_thickness_m;
    let height = 2.0 * circle_radius * source.roof_spec.shell_cross_rise_ratio;
    let c = (a * a + height * height) / (2.0 * a);
    let ci = c - thickness;
    if thickness >= a || height <= a || ci <= c - a {
        return Err("Coque ogivale sans intrados pointu valide.".into());
    }
    let inner_apex = libm::sqrt(ci * ci - (c - a).powi(2));
    let rib_stop = libm::sqrt(c * c - (c - a * 0.5).powi(2));
    if height - inner_apex < thickness - 0.001
        || (shell.rib_width_m > 0.0 && rib_stop >= inner_apex - 0.001)
    {
        return Err("Cap de coque/nervure sans épaisseur requise.".into());
    }
    let expected: Surface = vec![Polygon {
        outer: ring
            .iter()
            .map(|p| Point {
                x: center.x + (p.x - center.x) * (1.0 - thickness / a),
                y: center.y + (p.y - center.y) * (1.0 - thickness / a),
            })
            .collect(),
        holes: vec![],
    }];
    let actual = g::offset(&source.level.footprint, -thickness);
    if area(&difference(&expected, &g::offset(&actual, 0.001))) > g::area_tolerance(&expected)
        || area(&difference(&actual, &g::offset(&expected, 0.001))) > g::area_tolerance(&actual)
    {
        return Err("Intrados de coque non raccordé au sol à 1 mm.".into());
    }
    let perimeter = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(a, b)| libm::sqrt((b.x - a.x).powi(2) + (b.y - a.y).powi(2)))
        .sum::<f64>();
    let rib_count = if shell.rib_width_m == 0.0 {
        0
    } else {
        libm::ceil(perimeter / shell.rib_spacing_m) as usize
    };
    let half_angle = shell.rib_width_m / (2.0 * circle_radius);
    if rib_count > 0 && 2.0 * half_angle >= TAU / rib_count as f64 {
        return Err("Nervures de coque en recouvrement.".into());
    }
    let mut angles: Vec<_> = ring
        .iter()
        .map(|p| libm::atan2(p.y - center.y, p.x - center.x).rem_euclid(TAU))
        .collect();
    if ring.len() < source.roof_spec.round_segments as usize {
        angles.extend(
            (0..source.roof_spec.round_segments)
                .map(|i| TAU * i as f64 / source.roof_spec.round_segments as f64),
        );
    }
    for i in 0..rib_count {
        let angle = TAU * i as f64 / rib_count as f64;
        angles.extend([
            (angle - half_angle).rem_euclid(TAU),
            (angle + half_angle).rem_euclid(TAU),
        ]);
    }
    angles.sort_by(f64::total_cmp);
    angles.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
    let radial: Vec<_> = angles
        .iter()
        .map(|&theta| radius_on_ray(ring, center, theta).map(|r| r / a))
        .collect::<Result<_, _>>()?;
    let in_rib = |angle: f64| {
        rib_count > 0
            && (0..rib_count).any(|i| {
                let delta = (angle - TAU * i as f64 / rib_count as f64 + PI).rem_euclid(TAU) - PI;
                delta.abs() < half_angle - 1e-10
            })
    };
    let sectors: Vec<_> = angles
        .iter()
        .enumerate()
        .map(|(i, &theta)| {
            let end = if i + 1 < angles.len() {
                angles[i + 1]
            } else {
                angles[0] + TAU
            };
            in_rib((theta + end) * 0.5)
        })
        .collect();
    let beta = libm::asin(height / c);
    let inner_beta = libm::asin(inner_apex / ci);
    let stop_beta = libm::asin(rib_stop / c);
    let mut meridians: Vec<_> = (0..=source.roof_spec.curve_sections)
        .map(|i| beta * i as f64 / source.roof_spec.curve_sections as f64)
        .collect();
    meridians.extend([0.0, inner_beta, beta]);
    if rib_count > 0 {
        meridians.push(stop_beta);
    }
    meridians.sort_by(f64::total_cmp);
    meridians.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
    if meridians
        .windows(2)
        .any(|v| thickness * libm::cos((v[1] - v[0]) * 0.5) < thickness - 0.0005)
    {
        return Err("Résolution de coque insuffisante pour l'épaisseur à 1 mm.".into());
    }
    let vertex = |index: usize, phi: f64, arc: f64| {
        let capped = arc == ci && phi >= inner_beta - 1e-10;
        let r = if (arc == c && phi >= beta - 1e-10) || capped {
            0.0
        } else {
            (a - c + arc * libm::cos(phi)).max(0.0)
        } * radial[index];
        let z = if capped {
            inner_apex
        } else {
            arc * libm::sin(phi)
        };
        Vertex3 {
            x: center.x + r * libm::cos(angles[index]),
            y: center.y + r * libm::sin(angles[index]),
            z: source.support_z_m + z,
        }
    };
    let mut doors = vec![];
    for portal in unit
        .access
        .portals
        .iter()
        .filter(|p| matches!(p.kind, PortalKind::Door | PortalKind::Tunnel))
    {
        if portal.wall_id.as_ref().is_some_and(|id| {
            unit.walls
                .iter()
                .find(|w| &w.id == id)
                .is_some_and(|w| w.body_id.as_ref() != Some(&source.body_id))
        }) {
            continue;
        }
        doors.push(portal_planes(portal)?);
    }
    for i in 0..angles.len() {
        let j = (i + 1) % angles.len();
        for h in meridians.windows(2) {
            let [lo, hi] = [h[0], h[1]];
            let points = |arc: f64| {
                [
                    vertex(i, lo, arc),
                    vertex(j, lo, arc),
                    vertex(j, hi, arc),
                    vertex(i, hi, arc),
                ]
            };
            let covered = sectors[i] && hi <= stop_beta + 1e-10;
            let main = make_cell(
                points(c),
                points(ci),
                [
                    (!covered).then_some(RoofFaceKind::ShellOuter),
                    (lo < inner_beta - 1e-10).then_some(RoofFaceKind::ShellInner),
                    None,
                    None,
                    None,
                    None,
                ],
            );
            let mut cells = vec![main];
            if covered {
                cells.push(make_cell(
                    points(c + shell.rib_depth_m),
                    points(c),
                    [
                        Some(RoofFaceKind::ShellRib),
                        None,
                        (!sectors[(i + angles.len() - 1) % angles.len()])
                            .then_some(RoofFaceKind::ShellRib),
                        (!sectors[j]).then_some(RoofFaceKind::ShellRib),
                        None,
                        ((hi - stop_beta).abs() < 1e-10).then_some(RoofFaceKind::ShellRibEnd),
                    ],
                ));
            }
            for planes in &doors {
                cells = cells
                    .into_iter()
                    .flat_map(|cell| carve(cell, planes))
                    .collect();
            }
            for mut face in cells.into_iter().flatten() {
                let Some(kind) = face.kind else {
                    continue;
                };
                for &plane in &face.exposure {
                    face.vertices = polygon_clip(&face.vertices, plane);
                }
                if normal(&face.vertices).is_none() {
                    continue;
                }
                if face
                    .vertices
                    .iter()
                    .all(|v| (v.z - source.support_z_m).abs() < 1e-8)
                {
                    continue;
                }
                let mut t = template.clone();
                t.kind = kind;
                t.corbel = true;
                t.material = if kind == RoofFaceKind::ShellRib || kind == RoofFaceKind::ShellRibEnd
                {
                    shell.material.clone()
                } else {
                    source.level.materials.infill.clone()
                };
                if let Some(plane) = face
                    .vertices
                    .get(..3)
                    .and_then(|v| triangle_plane(&[v[0].clone(), v[1].clone(), v[2].clone()]))
                {
                    t.plane = plane;
                }
                raw.push(RawFace {
                    vertices: face.vertices,
                    source: t,
                });
            }
        }
    }
    groups.insert(
        source.group.clone(),
        RoofGroup {
            id: source.group.clone(),
            rf: source.roof_system.clone(),
            body_id: source.body_id.clone(),
            feature_id: None,
            room_id: None,
            level: source.level.index,
            domain: domain.clone(),
        },
    );
    Ok(())
}

pub(super) fn cover_references(raw: &[RawFace]) -> Vec<Candidate> {
    raw.iter()
        .filter(|f| {
            matches!(
                f.source.kind,
                RoofFaceKind::ShellOuter | RoofFaceKind::ShellRib | RoofFaceKind::ShellRibEnd
            )
        })
        .filter_map(|f| {
            let n = normal(&f.vertices)?;
            if n[2] <= EPS {
                return None;
            }
            let mut t = f.source.clone();
            t.kind = RoofFaceKind::Pan;
            t.domain = vec![Polygon {
                outer: f
                    .vertices
                    .iter()
                    .map(|v| Point { x: v.x, y: v.y })
                    .collect(),
                holes: vec![],
            }];
            (area(&t.domain) > EPS).then_some(t)
        })
        .collect()
}
