//! Roof signatures built from their physical contour and analytic profile.
use super::*;

fn distance(arm: &RoofArm, point: Point) -> f64 {
    let (x, y) = coordinates(arm, point);
    x.min(arm.length_m - x).min(y.min(arm.width_m - y))
}

fn profile(d: f64, span: f64, z: f64, pitch: f64, lift: f64) -> f64 {
    z + pitch * d + lift * span * ((1.0 - d / span).powi(2) - 1.0)
}

fn distances(arm: &RoofArm, covered: &Surface, s: &RoofSpec, pitch: f64) -> Vec<f64> {
    let span = arm.width_m.min(arm.length_m) * 0.5;
    let step = span / f64::from(s.curve_sections);
    let d_min = covered
        .iter()
        .flat_map(|polygon| std::iter::once(&polygon.outer).chain(&polygon.holes))
        .flatten()
        .map(|&point| distance(arm, point))
        .fold(0.0_f64, f64::min);
    let exterior_bands = libm::ceil(-d_min / step) as usize;
    let mut out = vec![d_min, 0.0, span];
    for i in 1..exterior_bands {
        out.push(-(i as f64) * step);
    }
    for i in 1..s.curve_sections {
        out.push(f64::from(i) * step);
    }
    if s.curve_lift_ratio > pitch * 0.5 {
        let minimum = span * (1.0 - pitch / (2.0 * s.curve_lift_ratio));
        if minimum > 0.0 && minimum < span {
            out.push(minimum);
        }
    }
    out.sort_by(f64::total_cmp);
    out.dedup();
    out
}

fn ring(arm: &RoofArm, d: f64) -> [Point; 4] {
    // Do not use local()->point(): snapping XY would move the analytic hips.
    [
        (d, d),
        (arm.length_m - d, d),
        (arm.length_m - d, arm.width_m - d),
        (d, arm.width_m - d),
    ]
    .map(|(x, y)| Point {
        x: arm.origin.x + arm.axis[0] * x - arm.axis[1] * y,
        y: arm.origin.y + arm.axis[1] * x + arm.axis[0] * y,
    })
}

fn curved_patches(
    arm: &RoofArm,
    covered: &Surface,
    z: f64,
    pitch: f64,
    s: &RoofSpec,
) -> Vec<(Surface, Plane)> {
    let span = arm.width_m.min(arm.length_m) * 0.5;
    let knots = distances(arm, covered, s, pitch);
    let mut out = vec![];
    for band in knots.windows(2) {
        let [d0, d1] = [band[0], band[1]];
        let z0 = profile(d0, span, z, pitch, s.curve_lift_ratio);
        let slope = (profile(d1, span, z, pitch, s.curve_lift_ratio) - z0) / (d1 - d0);
        let intercept = z0 - slope * d0;
        let outer = ring(arm, d0);
        let inner = ring(arm, d1);
        let planes = [
            affine(arm, 0.0, slope, intercept),
            affine(arm, -slope, 0.0, intercept + slope * arm.length_m),
            affine(arm, 0.0, -slope, intercept + slope * arm.width_m),
            affine(arm, slope, 0.0, intercept),
        ];
        for (side, plane) in planes.into_iter().enumerate() {
            let next = (side + 1) % 4;
            let mut boundary = vec![outer[side], outer[next], inner[next], inner[side]];
            // The final ring is a ridge or a point, so a trapezoid becomes a triangle.
            boundary.dedup();
            if boundary.first() == boundary.last() {
                boundary.pop();
            }
            let patch = intersection(
                &vec![Polygon {
                    outer: boundary,
                    holes: vec![],
                }],
                covered,
            );
            if !patch.is_empty() {
                out.push((patch, plane));
            }
        }
    }
    out
}

pub(super) fn curved(
    out: &mut Vec<Candidate>,
    template: &Candidate,
    arm: &RoofArm,
    covered: &Surface,
    z: f64,
    pitch: f64,
    spec: &RoofSpec,
) {
    for (domain, plane) in curved_patches(arm, covered, z, pitch, spec) {
        let mut candidate = template.clone();
        candidate.domain = domain;
        candidate.plane = plane;
        candidate.plan_id = out.len();
        out.push(candidate);
    }
}

pub(super) fn estimate_curved_patches(
    unit: &HouseUnit,
    source: &RoofSource,
) -> Result<usize, String> {
    let level = &source.level;
    let domain = top_covers(
        unit,
        source,
        level,
        source.support_z_m,
        &roof_domain(unit, source, level),
    );
    let mut patches = 0usize;
    for original in arms_for(source, level)? {
        let arm = if source.roof_spec.axis == RoofAxis::Transverse {
            RoofArm {
                origin: local(&original, original.length_m, 0.0),
                axis: [-original.axis[1], original.axis[0]],
                length_m: original.width_m,
                width_m: original.length_m,
                domain: original.domain.clone(),
            }
        } else {
            original
        };
        let extended = if source.feature_id.is_some() {
            intersection(&domain, &arm.domain)
        } else {
            roof_domain(
                unit,
                source,
                &Level {
                    footprint: arm.domain.clone(),
                    ..level.clone()
                },
            )
        };
        let covered = intersection(&domain, &extended);
        if !covered.is_empty() {
            let pitch = libm::tan(source.roof_pitch_deg * PI / 180.0);
            patches = patches.saturating_add(
                4 * (distances(&arm, &covered, &source.roof_spec, pitch).len() - 1),
            );
        }
    }
    Ok(patches)
}

pub(super) fn validate_horns(source: &RoofSource) -> Result<(), String> {
    let Some(spec) = &source.roof_spec.horns else {
        return Ok(());
    };
    if source.intermediate {
        return Ok(());
    }
    if source.roof_system != "RF-SADDLE"
        || !source.roof_spec.curve_sections.is_multiple_of(2)
        || !spec.central_span_ratio.is_finite()
        || !(0.4..=0.6).contains(&spec.central_span_ratio)
        || !spec.rise_ratio.is_finite()
        || !(0.15..=0.4).contains(&spec.rise_ratio)
        || !spec.outer_rise_scale.is_finite()
        || !(1.05..=1.25).contains(&spec.outer_rise_scale)
        || source.roof_arms.len() != 1
        || !source.voids.is_empty()
    {
        return Err(format!(
            "Signature quatre cornes incompatible : {} (RF-SADDLE, un bras rectangulaire et subdivisions paires requis).",
            source.id
        ));
    }
    Ok(())
}

pub(super) fn estimate_horn_faces(n: u32) -> usize {
    let n = n as usize;
    // Reviewed bound: triangulated grids, center fans, two steps and tympans.
    2 * (2 * n + 8) * (n + 4) * 2 + 2 * 2 * n + 2 * n
}

fn horn_height(
    arm: &RoofArm,
    spec: &HornRoofSpec,
    z: f64,
    pitch: f64,
    x: f64,
    y: f64,
    central: bool,
) -> f64 {
    let xc = x - arm.length_m * 0.5;
    let yc = y - arm.width_m * 0.5;
    let a = spec.central_span_ratio * arm.length_m * 0.5;
    let t_linear = 1.0 - 2.0 * yc.abs() / arm.width_m;
    let t = t_linear.max(0.0);
    let q = if central {
        (xc / a).clamp(-1.0, 1.0)
    } else {
        ((xc.abs() - a) / (arm.length_m * 0.5 - a)).clamp(0.0, 1.0)
    };
    let rise = spec.rise_ratio * arm.width_m * if central { 1.0 } else { spec.outer_rise_scale };
    z + pitch * arm.width_m * 0.5 * t_linear + rise * q.powi(2) * t.powi(2)
}

fn sorted(mut values: Vec<f64>) -> Vec<f64> {
    values.sort_by(f64::total_cmp);
    values.dedup();
    values
}

#[allow(clippy::too_many_arguments)]
pub(super) fn horns(
    unit: &HouseUnit,
    source: &RoofSource,
    template: &Candidate,
    arm: &RoofArm,
    covered: &Surface,
    z: f64,
    candidates: &mut Vec<Candidate>,
    raw: &mut Vec<RawFace>,
    features: &mut Vec<Feature>,
) -> Result<(), String> {
    use geo::{Closest, ClosestPoint, Intersects};
    let spec = source.roof_spec.horns.as_ref().unwrap();
    if arm.length_m < 1.2 * arm.width_m {
        return Err(format!(
            "Quatre cornes : longueur mur {:.3} m < 1.2 × largeur {:.3} m après orientation ({}).",
            arm.length_m, arm.width_m, source.id
        ));
    }
    let rectangle = local_surface(arm, 0.0, 0.0, arm.length_m, arm.width_m);
    if area(&difference(&rectangle, &arm.domain)) + area(&difference(&arm.domain, &rectangle))
        > g::area_tolerance(&rectangle)
    {
        return Err(format!(
            "Quatre cornes : bras non rectangulaire ({}).",
            source.id
        ));
    }
    let n = source.roof_spec.curve_sections;
    let pitch = libm::tan(source.roof_pitch_deg * PI / 180.0);
    let a = spec.central_span_ratio * arm.length_m * 0.5;
    let left = arm.length_m * 0.5 - a;
    let right = arm.length_m * 0.5 + a;
    let limits = covered
        .iter()
        .flat_map(|p| &p.outer)
        .map(|&p| coordinates(arm, p))
        .fold(
            [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ],
            |b, (x, y)| [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)],
        );
    let ys = sorted(
        std::iter::once(limits[1])
            .chain((0..=n).map(|i| arm.width_m * f64::from(i) / f64::from(n)))
            .chain(std::iter::once(limits[3]))
            .collect(),
    );
    for (name, lo, hi, steps, central) in [
        ("left", 0.0, left, n / 2, false),
        ("central", left, right, n, true),
        ("right", right, arm.length_m, n / 2, false),
    ] {
        let xmin = if name == "left" { limits[0] } else { lo };
        let xmax = if name == "right" { limits[2] } else { hi };
        let mut xs: Vec<_> = (0..=steps)
            .map(|i| lo + (hi - lo) * f64::from(i) / f64::from(steps))
            .collect();
        xs.extend([xmin, xmax]);
        if central {
            xs.push(arm.length_m * 0.5);
        }
        let xs = sorted(xs);
        let band = intersection(
            covered,
            &local_surface(arm, xmin, limits[1], xmax - xmin, limits[3] - limits[1]),
        );
        let mut t = template.clone();
        t.group = format!("{}:horns:{name}", template.group);
        for x in xs.windows(2) {
            for y in ys.windows(2) {
                let vertex_at =
                    |x, y| vertex(arm, x, y, horn_height(arm, spec, z, pitch, x, y, central));
                let v0 = vertex_at(x[0], y[0]);
                let v1 = vertex_at(x[1], y[0]);
                let v2 = vertex_at(x[1], y[1]);
                let v3 = vertex_at(x[0], y[1]);
                curve_triangle(candidates, &t, &band, [v0.clone(), v1, v2.clone()]);
                curve_triangle(candidates, &t, &band, [v0, v2, v3]);
            }
        }
    }
    let mut step_source = template.clone();
    step_source.group = format!("{}:horns:central", template.group);
    step_source.kind = RoofFaceKind::StepWall;
    step_source.material = source.level.materials.infill.clone();
    for (index, x) in [left, right].into_iter().enumerate() {
        let arc: Vec<_> = (0..=n)
            .map(|i| {
                let y = arm.width_m * f64::from(i) / f64::from(n);
                vertex(arm, x, y, horn_height(arm, spec, z, pitch, x, y, true))
            })
            .collect();
        let mut placed_arc = arc.clone();
        for foot_index in [0, n as usize] {
            let foot = &mut placed_arc[foot_index];
            let point = geo::Point::new(foot.x, foot.y);
            let seat = unit
                .walls
                .iter()
                .filter(|wall| {
                    wall.body_id.as_ref() == Some(&source.body_id)
                        && wall.level == source.level.index
                        && !wall.shell_reference
                        && wall.z_m <= z + 0.001
                        && wall.z_m + wall.height_m >= z - 0.003
                })
                .find_map(|wall| {
                    let section = g::to_geo(&crate::wall_geometry::wall_section(wall, z - 0.001));
                    let candidate = match section.closest_point(&point) {
                        Closest::Intersection(p) | Closest::SinglePoint(p) => p,
                        Closest::Indeterminate => return None,
                    };
                    (libm::hypot(candidate.x() - foot.x, candidate.y() - foot.y)
                        <= g::GRID_M * std::f64::consts::FRAC_1_SQRT_2
                        && section.intersects(&candidate))
                    .then_some(candidate)
                });
            let Some(seat) = seat else {
                return Err(format!(
                    "Quatre cornes : pied de ferme sans mur porteur à ({:.3}, {:.3}, {:.3}) : {}.",
                    foot.x, foot.y, z, source.id
                ));
            };
            foot.x = seat.x();
            foot.y = seat.y();
        }
        for i in 0..n {
            let y0 = arm.width_m * f64::from(i) / f64::from(n);
            let y1 = arm.width_m * f64::from(i + 1) / f64::from(n);
            let mut vertices = vec![
                vertex(arm, x, y0, horn_height(arm, spec, z, pitch, x, y0, false)),
                vertex(arm, x, y1, horn_height(arm, spec, z, pitch, x, y1, false)),
                arc[i as usize + 1].clone(),
                arc[i as usize].clone(),
            ];
            vertices.dedup();
            if vertices.first() == vertices.last() {
                vertices.pop();
            }
            raw.push(RawFace {
                vertices,
                source: step_source.clone(),
            });
        }
        features.push(roof_feature(
            format!(
                "roof:{}:{}:horns:frame:{index}",
                source.body_id, source.level.index
            ),
            FeatureKind::RoofArc,
            local_surface(arm, x - 0.04, 0.0, 0.08, arm.width_m),
            z,
            arc.iter().map(|v| v.z - z).fold(0.0_f64, f64::max),
            source.level.materials.roof_frame.clone(),
            placed_arc,
        ));
    }
    let first_tympan = raw.len();
    let mut tympan_source = template.clone();
    tympan_source.group = format!("{}:horns:left", template.group);
    end_profile(
        source,
        &source.level,
        &tympan_source,
        arm,
        z,
        n,
        RoofFaceKind::Tympanum,
        raw,
        features,
        |y| horn_height(arm, spec, z, pitch, 0.0, y, false),
    );
    for face in &mut raw[first_tympan..] {
        let p = &face.vertices[0];
        if coordinates(arm, Point { x: p.x, y: p.y }).0 > arm.length_m * 0.5 {
            face.source.group = format!("{}:horns:right", template.group);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arm(length_m: f64, width_m: f64) -> RoofArm {
        RoofArm {
            origin: Point { x: 0.0, y: 0.0 },
            axis: [1.0, 0.0],
            length_m,
            width_m,
            domain: g::rectangle(0.0, 0.0, length_m, width_m),
        }
    }

    #[test]
    fn curved_knots_include_real_exterior_eave_ridge_and_profile_minimum() {
        let arm = arm(12.0, 8.0);
        let mut covered = g::rectangle(-0.7, 0.0, 12.9, 8.4);
        covered[0].holes = vec![g::rectangle(4.0, 3.0, 1.0, 1.0)[0].outer.clone()];
        covered[0].holes[0].reverse();
        let spec = RoofSpec {
            curve_sections: 4,
            curve_lift_ratio: 0.3,
            ..RoofSpec::default()
        };
        let knots = distances(&arm, &covered, &spec, 0.4);
        assert!((knots[0] + 0.7).abs() < 1e-12);
        assert!(knots.contains(&0.0));
        assert_eq!(*knots.last().unwrap(), 4.0);
        assert!(knots.iter().any(|d| (*d - 4.0 / 3.0).abs() < 1e-12));
        assert!(profile(4.0 / 3.0, 4.0, 3.0, 0.4, spec.curve_lift_ratio) < 3.0);
        assert!(
            knots
                .windows(2)
                .all(|band| band[1] - band[0] <= 1.0 + 1e-12)
        );
        let patches = curved_patches(&arm, &covered, 3.0, 0.4, &spec);
        let bound = spec.curve_lift_ratio * 4.0 / (4.0 * f64::from(spec.curve_sections).powi(2));
        for (surface, plane) in &patches {
            for point in surface
                .iter()
                .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
                .flatten()
            {
                let height = profile(distance(&arm, *point), 4.0, 3.0, 0.4, spec.curve_lift_ratio);
                assert!((plane.height(*point) - height).abs() <= bound + 1e-8);
            }
        }
        let occupied = patches
            .iter()
            .flat_map(|(surface, _)| surface.clone())
            .collect();
        let parts = Partition {
            occupied,
            courtyards: vec![],
            circulation: vec![],
            service: vec![],
            residual: vec![],
        };
        crate::validation::partition_metrics(&covered, &parts).unwrap();
    }

    #[test]
    fn curved_chords_have_the_analytic_error_bound_and_exact_diagonal_hips() {
        for (length, width) in [(12.0, 8.0), (8.0, 8.0)] {
            let arm = arm(length, width);
            let spec = RoofSpec {
                curve_sections: 12,
                ..RoofSpec::default()
            };
            let span = width * 0.5;
            let knots = distances(&arm, &arm.domain, &spec, 0.8);
            let error =
                spec.curve_lift_ratio * span / (4.0 * f64::from(spec.curve_sections).powi(2));
            for band in knots.windows(2) {
                let d = (band[0] + band[1]) * 0.5;
                let chord = (profile(band[0], span, 3.0, 0.8, spec.curve_lift_ratio)
                    + profile(band[1], span, 3.0, 0.8, spec.curve_lift_ratio))
                    * 0.5;
                let actual = profile(d, span, 3.0, 0.8, spec.curve_lift_ratio);
                assert!(chord >= actual - 1e-12 && chord - actual <= error + 1e-12);
            }
            for d in knots {
                let corners = ring(&arm, d);
                assert!((corners[0].x - corners[0].y).abs() < 1e-12);
                assert!((corners[1].x + corners[1].y - length).abs() < 1e-12);
                assert!((corners[2].x - corners[2].y - length + width).abs() < 1e-12);
                assert!((corners[3].x + corners[3].y - width).abs() < 1e-12);
            }
        }
    }
}
