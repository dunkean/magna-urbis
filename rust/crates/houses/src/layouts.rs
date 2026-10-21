//! Reserved architectural domains, independent of the renderer and terrain.
use crate::catalogue::{
    CourtProgram, CourtTopology, Layout, Parameters, Placement, Recipe, SupportKind, VerticalAccess,
};
use crate::geometry::*;
use crate::model::*;
use magna_urbis_random::Rng;
use std::f64::consts::{PI, TAU};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct BodySpec {
    pub footprint: Surface,
    pub voids: Vec<Surface>,
    pub levels: Vec<Surface>,
    pub cells: Vec<StructuralCell>,
    pub parameters: Parameters,
    pub role: Role,
    pub component: Option<String>,
    pub z: f64,
    pub arms: Vec<RoofArm>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct LayoutPlan {
    pub lot: Surface,
    pub courts: Surface,
    pub paths: Surface,
    pub bodies: Vec<BodySpec>,
    pub features: Vec<Feature>,
    pub context: Vec<Feature>,
    pub diagnostics: Vec<String>,
}

/// Bounded burgage infill within the native row-house envelope. Separate native
/// rectangular bodies keep roof construction exact; courts and access stay open.
pub(crate) fn urban_frontage_infill(
    plan: &mut LayoutPlan,
    p: &Parameters,
    coverage: f64,
    seed: &str,
) {
    if p.layout != Layout::Strip
        || coverage < 0.66
        || plan.bodies.len() != 1
        || p.details.iter().any(|detail| detail == "arcade")
    {
        return;
    }
    let w = p.width_m[0] - 1.25;
    let d = p.depth_m[0];
    let rear = d * 0.25;
    let b = bounds(&plan.bodies[0].footprint);
    if (b[0]).abs() > 0.001
        || (b[1] - rear).abs() > 0.001
        || (b[2] - w).abs() > 0.001
        || (b[3] - d).abs() > 0.001
    {
        return;
    }
    let role = plan.bodies[0].role;
    let mut rng = Rng::new(seed).fork("urban-burgage-infill");
    let mut additions = vec![];
    // A habitable side range is possible only if a real court remains beside it.
    if w >= 4.0 && rear >= 2.2 {
        let wing = snap((w * rng.range(0.44, 0.56)).clamp(2.2, w - 1.8));
        additions.push(rectangle(0., 0., wing, rear));
    }
    // Retain at least a 1.8 m long court between front and rear ranges.
    if coverage >= 0.84 && rear >= 4.0 && rng.chance(0.7) {
        let depth = snap((rear * rng.range(0.4, 0.55)).clamp(2.2, rear - 1.8));
        let used = unite(&additions);
        let back = difference(&rectangle(0., 0., w, depth), &used);
        if area(&back) >= 4.0 {
            additions.push(back);
        }
    }
    for surface in additions {
        if surface.is_empty() {
            continue;
        }
        plan.courts = difference(&plan.courts, &surface);
        plan.paths = difference(&plan.paths, &surface);
        plan.bodies.push(spec(surface, p, role));
    }
    if plan.bodies.len() > 1 {
        plan.diagnostics.push("Seeded urban burgage infill: native side/rear ranges inside the source envelope, retaining a court and side access; artistic adaptation of the TypeScript frontage operator.".into());
    }
}

pub(crate) fn feature(
    id: &str,
    kind: FeatureKind,
    surface: Surface,
    z: f64,
    height: f64,
    material: &str,
) -> Feature {
    Feature {
        id: id.into(),
        kind,
        surface,
        z_m: snap(z),
        height_m: snap(height),
        material: material.into(),
        vertices3d: vec![],
        roof: None,
    }
}

fn arms(domains: &[Surface]) -> Vec<RoofArm> {
    domains
        .iter()
        .map(|s| {
            let mut best = axis_arm(s, [1.0, 0.0]);
            let mut best_area = best.length_m * best.width_m;
            for polygon in s {
                for (a, b) in polygon
                    .outer
                    .iter()
                    .zip(polygon.outer.iter().cycle().skip(1))
                    .take(polygon.outer.len())
                {
                    let length = libm::hypot(b.x - a.x, b.y - a.y);
                    if length < 0.001 {
                        continue;
                    }
                    let mut arm = axis_arm(s, [(b.x - a.x) / length, (b.y - a.y) / length]);
                    if arm.width_m > arm.length_m {
                        arm = axis_arm(s, [-arm.axis[1], arm.axis[0]]);
                    }
                    let area = arm.length_m * arm.width_m;
                    if area < best_area - 0.000_1
                        || ((area - best_area).abs() < 0.000_1 && best.width_m > best.length_m)
                    {
                        best = arm;
                        best_area = area;
                    }
                }
            }
            best
        })
        .collect()
}

fn axis_arm(s: &Surface, axis: [f64; 2]) -> RoofArm {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for q in s.iter().flat_map(|p| &p.outer) {
        let u = q.x * axis[0] + q.y * axis[1];
        let v = -q.x * axis[1] + q.y * axis[0];
        b[0] = b[0].min(u);
        b[1] = b[1].min(v);
        b[2] = b[2].max(u);
        b[3] = b[3].max(v);
    }
    RoofArm {
        source_component: None,
        origin: point(
            b[0] * axis[0] - b[1] * axis[1],
            b[0] * axis[1] + b[1] * axis[0],
        ),
        axis,
        length_m: b[2] - b[0],
        width_m: b[3] - b[1],
        domain: s.clone(),
    }
}

fn minimum_domain(p: &Parameters) -> [f64; 2] {
    let wall = p.wall_thickness_m[0] * 2.0;
    let grid = libm::ceil(libm::sqrt(p.rooms_per_body[0].max(1) as f64));
    let mut dims = [(wall + grid * 1.4).max(2.0); 2];
    if p.floors[0] > 1
        && matches!(
            p.vertical_access,
            VerticalAccess::InternalStair | VerticalAccess::IntramuralStair
        )
    {
        dims[0] = dims[0].max(wall + 2.2);
        dims[1] = dims[1].max(wall + (p.level_height_m * 0.95).max(2.6) + 1.4);
    }
    if p.details
        .iter()
        .any(|t| matches!(t.as_str(), "setbacks" | "terraces" | "slope_terraces"))
    {
        let retreat = p.floors[0].saturating_sub(1) as f64 * 0.7;
        dims[0] += retreat;
        dims[1] += retreat;
    }
    if let Some(lightwell) = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.lightwell.as_ref())
    {
        let clear_ring = p.wall_thickness_m[0] + 1.2;
        dims[0] = dims[0].max(lightwell.width_m + clear_ring * 2.0);
        dims[1] = dims[1].max(lightwell.depth_m + clear_ring * 2.0);
    }
    dims
}

fn lightwells(p: &Parameters, out: &mut LayoutPlan) -> Result<(), String> {
    let Some(spec) = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.lightwell.as_ref())
    else {
        return Ok(());
    };
    let count = spec.count as usize;
    if count == 0
        || count > out.bodies.len()
        || spec.width_m < 0.5
        || spec.depth_m < 0.5
        || spec.border_m < 0.1
    {
        return Err("Puits de lumière : nombre, dimensions ou bordure invalides.".into());
    }
    for (i, body) in out.bodies.iter_mut().take(count).enumerate() {
        let b = bounds(&body.footprint);
        let void = rectangle(
            (b[0] + b[2] - spec.width_m) * 0.5,
            (b[1] + b[3] - spec.depth_m) * 0.5,
            spec.width_m,
            spec.depth_m,
        );
        let margin = body.parameters.wall_thickness_m[0] + 1.2;
        if area(&difference(&offset(&void, margin), &body.footprint)) > 0.000_001
            || body
                .levels
                .iter()
                .any(|level| area(&difference(&offset(&void, margin), level)) > 0.000_001)
        {
            return Err(format!(
                "Puits {i} : le vide et son dégagement de {margin:.3} m ne sont pas contenus dans chaque enveloppe brute."
            ));
        }
        body.footprint = difference(&body.footprint, &void);
        for level in &mut body.levels {
            *level = difference(level, &void);
        }
        for cell in &mut body.cells {
            cell.footprint = difference(&cell.footprint, &void);
            if cell.footprint.len() != 1 {
                return Err(format!(
                    "Puits {i} : une cellule entière serait divisée ; aucun compte réduit."
                ));
            }
        }
        for arm in &mut body.arms {
            arm.domain = difference(&arm.domain, &void);
        }
        body.voids.push(void.clone());
        out.courts = union(&out.courts, &void);
        out.diagnostics.push(format!("Puits de lumière {i} : vide réel {:.3} × {:.3} m traversant {} niveaux, sols et couverture, dégagement brut {margin:.3} m ; dimensions stylisées, indépendant du ratio de cour.",spec.width_m,spec.depth_m,body.levels.len()));
    }
    Ok(())
}

fn spec(s: Surface, p: &Parameters, role: Role) -> BodySpec {
    let count = p.floors[0];
    let z = match p.support.kind {
        SupportKind::Posts | SupportKind::Piers | SupportKind::Raft => p.support.height_m[0],
        _ => {
            if matches!(p.elevation_family.as_str(), "sunken" | "excavated") {
                -2.4
            } else {
                0.0
            }
        }
    };
    let levels = (0..count)
        .map(|i| {
            if p.details
                .iter()
                .any(|t| t == "setbacks" || t == "terraces" || t == "slope_terraces")
                && i > 0
            {
                offset(&s, -(i as f64 * 0.35))
            } else {
                s.clone()
            }
        })
        .collect();
    BodySpec {
        voids: vec![],
        arms: arms(std::slice::from_ref(&s)),
        footprint: s,
        levels,
        cells: vec![],
        parameters: p.clone(),
        role,
        component: None,
        z,
    }
}

fn ring_sector(w: f64, d: f64, inner: f64, start: f64, end: f64, segments: usize) -> Surface {
    let mut ring = vec![];
    for i in 0..=segments {
        let a = start + (end - start) * i as f64 / segments as f64;
        ring.push(point(
            w * 0.5 + w * 0.5 * libm::cos(a),
            d * 0.5 + d * 0.5 * libm::sin(a),
        ));
    }
    for i in (0..=segments).rev() {
        let a = start + (end - start) * i as f64 / segments as f64;
        ring.push(point(
            w * 0.5 + w * inner * 0.5 * libm::cos(a),
            d * 0.5 + d * inner * 0.5 * libm::sin(a),
        ));
    }
    vec![Polygon {
        outer: ring,
        holes: vec![],
    }]
}

fn reserve_court(w: f64, d: f64, ratio: f64) -> Surface {
    let r = libm::sqrt(ratio);
    rectangle(w * (1.0 - r) * 0.5, d * (1.0 - r) * 0.5, w * r, d * r)
}

fn ranked_courts(
    p: &Parameters,
    program: &CourtProgram,
    role: Role,
    seed: &str,
    requested: [f64; 2],
    out: &mut LayoutPlan,
) -> Result<[f64; 2], String> {
    if program.topology != CourtTopology::Axial {
        return Err(
            "CourtProgram : la topologie grille n'a pas encore d'opérateur physique.".into(),
        );
    }
    let stages = program.courts.len();
    let hall_count = usize::from(program.north_hall.is_some());
    let count = p.bodies[0] as usize;
    if stages == 0 || stages > 8 || count < stages * 2 + hall_count {
        return Err("Cours classées : au moins deux corps entiers par cour, plus la salle nord déclarée, sont nécessaires.".into());
    }
    if !program.courts.windows(2).all(|c| c[0].rank < c[1].rank)
        || program.courts.iter().any(|c| {
            !c.ratio.is_finite() || c.ratio <= 0.0 || !c.aspect.is_finite() || c.aspect <= 0.0
        })
        || !(0.1..=0.8).contains(&p.courtyard_ratio[0])
        || program.threshold.width_m < 1.4
        || program.threshold.wall_m <= 0.0
        || program.threshold.height_m < 2.2
    {
        return Err("Cours classées : rangs, proportions ou seuils physiques invalides.".into());
    }
    let gap = 1.4;
    let mut minimum = minimum_domain(p);
    let fp = program.body_footprint.as_deref().unwrap_or("FP-RECT");
    if fp == "FP-U" {
        // Preserve a complete U block, including usable side and rear arms.
        minimum[0] /= 0.18;
        minimum[1] /= 0.18;
    } else if fp != "FP-RECT" {
        return Err(format!(
            "Cours classées : bloc {fp} sans opérateur déclaré."
        ));
    }
    let remaining = count - hall_count;
    let allocations: Vec<_> = (0..stages)
        .map(|i| remaining / stages + usize::from(i < remaining % stages))
        .collect();
    let weight: f64 = program.courts.iter().map(|c| c.ratio).sum();
    let mut w = requested[0].max(2.0 * minimum[0] / (1.0 - p.courtyard_ratio[0]));
    let hall_depth = program
        .north_hall
        .as_ref()
        .map_or(0.0, |h| h.depth_m.max(minimum[1]) + gap);
    let mut usable_depth =
        (requested[1] - hall_depth - stages.saturating_sub(1) as f64 * gap).max(0.0);
    for (court, n) in program.courts.iter().rev().zip(&allocations) {
        let rows = n.div_ceil(2);
        let stage_minimum = (rows as f64 * minimum[1] + rows.saturating_sub(1) as f64 * gap)
            .max(w * p.courtyard_ratio[0] / court.aspect);
        usable_depth = usable_depth.max(stage_minimum * weight / court.ratio);
    }
    // The same generator grid is used for walls, court bounds and body edges.
    w = libm::ceil(w * 1000.0) / 1000.0 + 0.002;
    usable_depth = libm::ceil(usable_depth * 1000.0) / 1000.0 + 0.002;
    let d = usable_depth + hall_depth + stages.saturating_sub(1) as f64 * gap;
    let court_width = snap(w * p.courtyard_ratio[0]);
    let side_width = snap((w - court_width) * 0.5);
    let court_x = side_width;
    let mut y = hall_depth;
    let mut index = 0;
    // The entrance is south: rank one is met first, the terminal northern
    // courtyard has the highest rank and serves the high central hall.
    for (stage, (court, n)) in program.courts.iter().rev().zip(&allocations).enumerate() {
        let stage_depth = snap(usable_depth * court.ratio / weight);
        let surface = rectangle(court_x, y, court_width, stage_depth);
        out.courts = union(&out.courts, &surface);
        out.features.push(feature(
            &format!("court-rank-{}", court.rank),
            FeatureKind::Courtyard,
            surface.clone(),
            0.0,
            0.0,
            "",
        ));
        for side in 0..2 {
            let rows = n / 2 + usize::from(side == 0 && n % 2 != 0);
            let body_depth =
                snap((stage_depth - rows.saturating_sub(1) as f64 * gap) / rows as f64);
            let x = if side == 0 { 0.0 } else { w - side_width };
            for row in 0..rows {
                let by = y + row as f64 * (body_depth + gap);
                let mut cp = p.clone();
                cp.footprint_family = fp.into();
                cp.bodies = [1; 2];
                cp.components.clear();
                let mut body = primitive_spec(
                    fp,
                    side_width,
                    body_depth,
                    &format!("{seed}:court:{stage}:{index}"),
                    &cp,
                    role,
                )?;
                if fp == "FP-U" {
                    let left = snap(side_width * 0.28);
                    let right = snap(side_width * 0.72);
                    let rear = snap(body_depth * 0.3);
                    let outline = vec![Polygon {
                        outer: vec![
                            point(0.0, 0.0),
                            point(side_width, 0.0),
                            point(side_width, body_depth),
                            point(right, body_depth),
                            point(right, rear),
                            point(left, rear),
                            point(left, body_depth),
                            point(0.0, body_depth),
                        ],
                        holes: vec![],
                    }];
                    body = spec(outline, &cp, role);
                    body.arms = arms(&[
                        rectangle(0.0, 0.0, side_width, rear),
                        rectangle(0.0, 0.0, left, body_depth),
                        rectangle(right, 0.0, side_width - right, body_depth),
                    ]);
                }
                body.footprint = translate(&body.footprint, x, by);
                body.levels = body.levels.iter().map(|s| translate(s, x, by)).collect();
                for arm in &mut body.arms {
                    arm.origin.x += x;
                    arm.origin.y += by;
                    arm.domain = translate(&arm.domain, x, by);
                }
                body.component = Some(format!("court-{}-wing-{side}-{row}", court.rank));
                if fp == "FP-U" {
                    out.courts = union(
                        &out.courts,
                        &difference(&rectangle(x, by, side_width, body_depth), &body.footprint),
                    );
                }
                out.bodies.push(body);
                index += 1;
            }
        }
        if let Some(portico) = &program.portico {
            if portico.span_m <= 0.0 || portico.span_m * 2.0 >= court_width.min(stage_depth) {
                return Err("Portique de cour : profondeur sans noyau libre.".into());
            }
            let gallery = difference(&surface, &offset(&surface, -portico.span_m));
            out.features.push(feature(
                &format!("ranked-court-{}-portico", court.rank),
                FeatureKind::Gallery,
                gallery.clone(),
                0.0,
                0.18,
                &p.materials.frame,
            ));
            out.paths = union(&out.paths, &gallery);
        }
        if stage + 1 < stages {
            let boundary = y + stage_depth + gap * 0.5;
            let wall = rectangle(
                -5.75,
                boundary - program.threshold.wall_m * 0.5,
                w + 11.5,
                program.threshold.wall_m,
            );
            let passage = rectangle(
                w * 0.5 - program.threshold.width_m * 0.5,
                boundary - gap,
                program.threshold.width_m,
                gap * 2.0,
            );
            out.features.push(feature(
                &format!(
                    "court-threshold-{}-{}",
                    court.rank,
                    program.courts[stages - stage - 2].rank
                ),
                FeatureKind::Enclosure,
                if p.site_gate_profile.is_some() {
                    wall.clone()
                } else {
                    difference(&wall, &passage)
                },
                0.0,
                program.threshold.height_m,
                &program.threshold.material,
            ));
            // Profiled access cuts the full native wall and preserves its
            // lintel. Unprofiled legacy openings keep their explicit lintel.
            if p.site_gate_profile.is_none() {
                out.features.push(feature(
                    &format!("court-threshold-{}-lintel", court.rank),
                    FeatureKind::Enclosure,
                    intersection(&wall, &passage),
                    2.2,
                    program.threshold.height_m - 2.2,
                    &program.threshold.material,
                ));
            }
        }
        out.diagnostics.push(format!("Cour de rang {} : domaine {:.3} × {:.3} m, {} corps entiers, seuil axial de {:.3} m ; proportions de construction {}.",court.rank,court_width,stage_depth,n,program.threshold.width_m,program.confidence));
        y = snap(y + stage_depth + gap);
    }
    if let Some(hall) = &program.north_hall {
        let mut cp = p.clone();
        cp.level_height_m = hall.height_m;
        cp.bodies = [1; 2];
        cp.components.clear();
        let mut body = spec(
            rectangle(court_x, 0.0, court_width, hall_depth - gap),
            &cp,
            role,
        );
        body.component = Some("north_hall".into());
        out.bodies.push(body);
        out.diagnostics.push(format!("Salle nord terminale : hauteur déclarée {:.3} m ; ailes {:.3} m, compte total {} conservé.",hall.height_m,p.level_height_m,count));
    }
    out.paths = union(
        &out.paths,
        &rectangle(
            w * 0.5 - program.threshold.width_m * 0.5,
            0.0,
            program.threshold.width_m,
            d,
        ),
    );
    if out.bodies.len() != count {
        return Err("Cours classées : compte de corps différent du programme explicite.".into());
    }
    if [w, d] != requested {
        out.diagnostics.push(format!("Cours classées : dimensions {:.3} × {:.3} → {:.3} × {:.3} m pour {} cours et {} corps entiers, murs et accès conservés.",requested[0],requested[1],w,d,stages,count));
    }
    Ok([w, d])
}

fn iwan_court(
    p: &Parameters,
    program: &CourtProgram,
    role: Role,
    w: f64,
    d: f64,
    out: &mut LayoutPlan,
) -> Result<(), String> {
    let iwans = program
        .iwans
        .as_ref()
        .ok_or("Plan à iwans sans spécification de baies.")?;
    if !(1..=4).contains(&iwans.count)
        || iwans.count != p.bodies[0]
        || !(0.5..=1.0).contains(&iwans.min_open_ratio)
        || !["RF-VAULT", "RF-THATCH-VAULT"].contains(&p.roof_system.as_str())
    {
        return Err("Iwans : compte, ouverture ou couverture voûtée incompatible avec le programme explicite.".into());
    }
    out.courts = reserve_court(w, d, p.courtyard_ratio[0]);
    let b = bounds(&out.courts);
    // Separate niches face the court; their vault axes are perpendicular to
    // it. No transverse court gallery crosses their true open ends.
    let domains = [
        (
            rectangle(b[0], 0.0, b[2] - b[0], b[1]),
            [0.0, 1.0],
            VaultEnd::End,
            "north",
        ),
        (
            rectangle(b[2], b[1], w - b[2], b[3] - b[1]),
            [1.0, 0.0],
            VaultEnd::Start,
            "east",
        ),
        (
            rectangle(b[0], b[3], b[2] - b[0], d - b[3]),
            [0.0, 1.0],
            VaultEnd::Start,
            "south",
        ),
        (
            rectangle(0.0, b[1], b[0], b[3] - b[1]),
            [1.0, 0.0],
            VaultEnd::End,
            "west",
        ),
    ];
    for (domain, axis, end, name) in domains.into_iter().take(iwans.count as usize) {
        let arm = axis_arm(&domain, axis);
        let mut cp = p.clone();
        let thickness = p.wall_thickness_m[0].max(arm.width_m * iwans.bearing_ratio + 0.002);
        cp.wall_thickness_m = [thickness; 2];
        cp.roof_spec.vault = Some(VaultSpec {
            open_ends: vec![end],
            bearing_ratio: iwans.bearing_ratio,
        });
        cp.gallery_cover.enabled = false;
        let mut body = spec(domain, &cp, role);
        body.arms = vec![arm];
        body.component = Some(format!("iwan-{name}"));
        out.bodies.push(body);
        out.diagnostics.push(format!("Iwan {name} : voûte perpendiculaire à la cour, extrémité ouverte {:?}, ratio libre {:.3}, murs porteurs {:.3} m (construction {}) ; pièces et niveaux conservés.",end,iwans.min_open_ratio,thickness,program.confidence));
    }
    out.paths = rectangle(
        w * 0.5 - program.threshold.width_m * 0.5,
        b[3],
        program.threshold.width_m,
        d - b[3],
    );
    // The south niche is approached around its sides, never counted as a
    // public through-room. The free corner strips reach the open court.
    Ok(())
}

fn private_cell_hatch(p: &Parameters) -> Option<(f64, f64)> {
    if matches!(
        p.vertical_access,
        VerticalAccess::IntramuralStair | VerticalAccess::ExteriorStair
    ) || p.details.iter().any(|detail| detail == "inhabited_ring")
        || (p.roof_system != "RF-FLAT"
            && p.vertical_access != VerticalAccess::RoofHatch
            && p.floors[0] <= 1)
    {
        return None;
    }
    let routes: Vec<_> = p
        .vertical_routes
        .iter()
        .filter(|route| route.to_level < p.floors[0])
        .cloned()
        .collect();
    Some(crate::vertical_footprint::vertical_footprint(
        p.vertical_access,
        &routes,
        p.level_height_m,
    ))
}

fn hatch_grid_certified(w: f64, d: f64, wall: f64, hatch: (f64, f64)) -> bool {
    let clear_w = w - 2.0 * wall;
    let clear_d = d - 2.0 * wall;
    // The shaft anchor reserves .031 m at each side; the reviewed local
    // centimetre also covers cell corners and geometry rounding.
    let margin = 2.0 * 0.031 + 0.01;
    clear_w.min(clear_d) >= hatch.0.min(hatch.1) + margin
        && clear_w.max(clear_d) >= hatch.0.max(hatch.1) + margin
        && clear_w * clear_d >= hatch.0 * hatch.1 + 0.45
}

fn whole_cells(
    p: &Parameters,
    mut w: f64,
    mut d: f64,
    n: usize,
    seed: &str,
    hatch: Option<(f64, f64)>,
) -> Result<(f64, f64, Surface, Surface, Vec<Surface>), String> {
    if n == 0 || n > 600 {
        return Err("Nombre de cellules hors limites.".into());
    }
    let minimum = 2.4_f64.max(p.wall_thickness_m[0] + 1.4);
    for _ in 0..32 {
        let outer = if p.footprint_family == "FP-APSIDAL" {
            primitive("FP-APSIDAL", w, d, seed)?.footprint
        } else {
            rectangle(0.0, 0.0, w, d)
        };
        let ratio = libm::sqrt(p.courtyard_ratio[0]);
        let court = if p.footprint_family == "FP-APSIDAL" {
            translate(
                &primitive("FP-APSIDAL", w * ratio, d * ratio, seed)?.footprint,
                w * (1.0 - ratio) * 0.5,
                d * (1.0 - ratio) * 0.5,
            )
        } else {
            reserve_court(w, d, p.courtyard_ratio[0])
        };
        let gate = rectangle(w * 0.5 - 0.8, d * 0.5, 1.6, d * 0.5 + 0.01);
        let domain = difference(&difference(&outer, &court), &gate);
        let first =
            libm::ceil(libm::sqrt(n as f64 * w / d / (1.0 - p.courtyard_ratio[0]))) as usize;
        for cols in first.max(2)..=libm::floor(w / minimum) as usize {
            let rows = libm::ceil(cols as f64 * d / w) as usize;
            if d / (rows as f64) < minimum {
                break;
            }
            if let Some(hatch) = hatch
                && !hatch_grid_certified(
                    w / cols as f64,
                    d / rows as f64,
                    p.wall_thickness_m[0],
                    hatch,
                )
            {
                continue;
            }
            let mut candidates = vec![];
            for row in 0..rows {
                for col in 0..cols {
                    let cell = rectangle(
                        col as f64 * w / cols as f64,
                        row as f64 * d / rows as f64,
                        w / cols as f64,
                        d / rows as f64,
                    );
                    if area(&difference(&cell, &domain)) < 0.000_01 {
                        candidates.push(cell);
                    }
                }
            }
            if candidates.len() >= n {
                let cells = (0..n)
                    .map(|i| candidates[i * candidates.len() / n].clone())
                    .collect();
                return Ok((w, d, court, gate, cells));
            }
        }
        w *= 1.15;
        d *= 1.15;
        if w > 1000.0 || d > 1000.0 {
            break;
        }
    }
    let required = hatch.map_or_else(String::new, |(width, run)| {
        format!(
            " Clair requis : {:.3} × {:.3} m dans une orientation, aire ≥ {:.3} m² pour la trémie {width:.3} × {run:.3} m.",
            width.min(run) + 0.072,
            width.max(run) + 0.072,
            width * run + 0.45,
        )
    });
    Err(format!(
        "Impossible de conserver {n} cellules entières de largeur ≥ {minimum:.3} m.{required}"
    ))
}

struct RingCell {
    footprint: Surface,
    inner_edge: [Point; 2],
    outer_edge: [Point; 2],
}

struct RingPartition {
    court: Surface,
    gallery: Surface,
    cells: Vec<RingCell>,
    arms: Vec<RoofArm>,
}

fn rectangular_ring_cells(
    w: f64,
    d: f64,
    ratio: f64,
    n: usize,
    gallery_width: f64,
) -> Result<RingPartition, String> {
    if n < 5 {
        return Err("L'anneau carré requiert au moins cinq cellules autour du portail.".into());
    }
    let hole = reserve_court(w, d, ratio);
    let b = bounds(&hole);
    // A diagonal separates adjacent sides. Every cell receives one straight
    // inner frontage, including corner cells; the south portal stays open.
    let sides = [
        (
            [point(b[0], b[1]), point(b[2], b[1])],
            [point(0.0, 0.0), point(w, 0.0)],
        ),
        (
            [point(b[2], b[1]), point(b[2], b[3])],
            [point(w, 0.0), point(w, d)],
        ),
        (
            [point(b[2], b[3]), point(w * 0.5 + 0.8, b[3])],
            [point(w, d), point(w * 0.5 + 0.8, d)],
        ),
        (
            [point(w * 0.5 - 0.8, b[3]), point(b[0], b[3])],
            [point(w * 0.5 - 0.8, d), point(0.0, d)],
        ),
        (
            [point(b[0], b[3]), point(b[0], b[1])],
            [point(0.0, d), point(0.0, 0.0)],
        ),
    ];
    let lengths =
        sides.map(|(inner, _)| libm::hypot(inner[1].x - inner[0].x, inner[1].y - inner[0].y));
    let total: f64 = lengths.iter().sum();
    let quotas = lengths.map(|length| (n - 5) as f64 * length / total);
    let mut counts = quotas.map(|quota| 1 + libm::floor(quota) as usize);
    let mut order: Vec<_> = (0..5).collect();
    order.sort_by(|a, z| {
        (quotas[*z] - libm::floor(quotas[*z]))
            .total_cmp(&(quotas[*a] - libm::floor(quotas[*a])))
            .then(a.cmp(z))
    });
    for side in order.into_iter().take(n - counts.iter().sum::<usize>()) {
        counts[side] += 1;
    }
    let mut cells = vec![];
    let mut roof_arms = vec![];
    let interpolate = |edge: [Point; 2], t: f64| {
        point(
            edge[0].x + (edge[1].x - edge[0].x) * t,
            edge[0].y + (edge[1].y - edge[0].y) * t,
        )
    };
    for (index, (inner, outer)) in sides.into_iter().enumerate() {
        let strip = vec![Polygon {
            outer: vec![outer[0], outer[1], inner[1], inner[0]],
            holes: vec![],
        }];
        let axis = [inner[1].x - inner[0].x, inner[1].y - inner[0].y];
        let length = libm::hypot(axis[0], axis[1]);
        roof_arms.push(axis_arm(&strip, [axis[0] / length, axis[1] / length]));
        let k = counts[index];
        let inner_points: Vec<_> = (0..=k)
            .map(|i| interpolate(inner, i as f64 / k as f64))
            .collect();
        let outer_points: Vec<_> = (0..=k)
            .map(|i| interpolate(outer, i as f64 / k as f64))
            .collect();
        for i in 0..k {
            cells.push(RingCell {
                footprint: vec![Polygon {
                    outer: vec![
                        outer_points[i],
                        outer_points[i + 1],
                        inner_points[i + 1],
                        inner_points[i],
                    ],
                    holes: vec![],
                }],
                inner_edge: [inner_points[i], inner_points[i + 1]],
                outer_edge: [outer_points[i], outer_points[i + 1]],
            });
        }
    }
    let court = offset(&hole, -gallery_width);
    let gallery = difference(&hole, &court);
    Ok(RingPartition {
        court,
        gallery,
        cells,
        arms: roof_arms,
    })
}

fn primitive_spec(
    fp: &str,
    w: f64,
    d: f64,
    seed: &str,
    p: &Parameters,
    role: Role,
) -> Result<BodySpec, String> {
    let shape = primitive_with_options(
        fp,
        w,
        d,
        seed,
        PrimitiveOptions {
            bodies: p.bodies[0].max(1),
            courtyard_ratio: p.courtyard_ratio[0],
            tiers: p.floors[0],
        },
    )?;
    let mut body = spec(shape.footprint, p, role);
    body.arms = arms(&shape.body_domains);
    // Orthogonal arms extend through their shared corner before roof min/max.
    if matches!(fp, "FP-L" | "FP-U" | "FP-COMPLEX" | "FP-COURT" | "FP-CROSS") {
        let envelope = body.footprint.clone();
        for arm in &mut body.arms {
            let extension = arm.width_m.min(arm.length_m) * 0.5;
            arm.domain = intersection(&offset(&arm.domain, extension), &envelope);
            *arm = arms(std::slice::from_ref(&arm.domain)).remove(0);
        }
    }
    Ok(body)
}

/// Experimental primitives use exact requested envelope dimensions. They never
/// invoke the atlas's dimensional enlargement or a fabricated cultural recipe.
pub(crate) fn build_workshop_layout(
    role: Role,
    p: &Parameters,
    seed: &str,
) -> Result<LayoutPlan, String> {
    let w = p.width_m[0];
    let d = p.depth_m[0];
    if ["FP-SQUARE", "FP-TOWER", "FP-ROUND"].contains(&p.footprint_family.as_str())
        && (w - d).abs() > 0.000_001
    {
        return Err("La primitive atelier carrée ou ronde exige deux dimensions égales.".into());
    }
    let mut shape = if p.footprint_family == "FP-CLUSTER-ROUND" && p.bodies[0] == 1 {
        primitive("FP-ROUND", w, d, seed)?
    } else if p.footprint_family == "FP-MULTICELL" && p.bodies[0] > 1 {
        let (cw, cd, court, gate, cells) = whole_cells(p, w, d, p.bodies[0] as usize, seed, None)?;
        if (cw - w).abs() > 0.000_001 || (cd - d).abs() > 0.000_001 {
            return Err(format!(
                "Atelier : {} cellules entières ne tiennent pas dans {w:.3} × {d:.3} m ; aucun agrandissement autorisé.",
                p.bodies[0]
            ));
        }
        PrimitiveShape {
            footprint: unite(&cells),
            body_domains: cells,
            courts: court,
            tiers: vec![],
            excavation: gate,
        }
    } else if p.footprint_family == "FP-MULTICELL" {
        primitive_with_options(
            "FP-ELLIPTICAL-RING",
            w,
            d,
            seed,
            PrimitiveOptions {
                bodies: 1,
                courtyard_ratio: p.courtyard_ratio[0],
                tiers: p.floors[0],
            },
        )?
    } else {
        primitive_with_options(
            &p.footprint_family,
            w,
            d,
            seed,
            PrimitiveOptions {
                bodies: p.bodies[0].max(1),
                courtyard_ratio: p.courtyard_ratio[0],
                tiers: p.floors[0],
            },
        )?
    };
    if p.footprint_family == "FP-TERRACE"
        && (p.floors[0] < 2 || !["RF-FLAT", "RF-STEP"].contains(&p.roof_system.as_str()))
    {
        return Err(
            "Les gradins atelier exigent au moins deux niveaux et RF-FLAT ou RF-STEP.".into(),
        );
    }
    // Apply the same affine map once to every generator domain and shared point.
    // This preserves requested bounds even for triconches and irregular shapes.
    let sb = bounds(&shape.footprint);
    if sb[2] - sb[0] < 0.001 || sb[3] - sb[1] < 0.001 {
        return Err("Primitive atelier dégénérée.".into());
    }
    let normalize = |surface: &mut Surface| {
        for poly in surface {
            for ring in std::iter::once(&mut poly.outer).chain(poly.holes.iter_mut()) {
                for q in ring {
                    q.x = (q.x - sb[0]) * w / (sb[2] - sb[0]);
                    q.y = (q.y - sb[1]) * d / (sb[3] - sb[1]);
                }
            }
        }
    };
    normalize(&mut shape.footprint);
    normalize(&mut shape.courts);
    normalize(&mut shape.excavation);
    for s in shape.body_domains.iter_mut().chain(shape.tiers.iter_mut()) {
        normalize(s);
    }
    let mut out = LayoutPlan {
        lot: rectangle(-6.0, -6.0, w + 12.0, d + 12.0),
        courts: shape.courts.clone(),
        paths: vec![],
        bodies: vec![],
        features: vec![],
        context: vec![],
        diagnostics: vec![format!(
            "Atelier stylisé : enveloppe imposée {w:.3} × {d:.3} m, marge de parcelle explicite 6 m ; aucune dimension agrandie."
        )],
    };
    let minimum = minimum_domain(p);
    for domain in &shape.body_domains {
        for polygon in domain {
            let footprint = vec![polygon.clone()];
            let b = bounds(&footprint);
            let size = [b[2] - b[0], b[3] - b[1]];
            if !((size[0] >= minimum[0] && size[1] >= minimum[1])
                || (size[1] >= minimum[0] && size[0] >= minimum[1]))
            {
                return Err(format!(
                    "Corps atelier {:.3} × {:.3} m trop étroit pour murs, pièces et accès ({:.3} × {:.3} m requis).",
                    size[0], size[1], minimum[0], minimum[1]
                ));
            }
            let mut cp = p.clone();
            cp.bodies = [1, 1];
            cp.components.clear();
            let mut body = spec(footprint, &cp, role);
            body.arms = arms(std::slice::from_ref(&body.footprint));
            if p.footprint_family == "FP-TERRACE" {
                body.levels = std::iter::once(body.footprint.clone())
                    .chain(shape.tiers.iter().cloned())
                    .collect();
                for level in &body.levels {
                    let b = bounds(level);
                    let size = [b[2] - b[0], b[3] - b[1]];
                    if !((size[0] >= minimum[0] && size[1] >= minimum[1])
                        || (size[1] >= minimum[0] && size[0] >= minimum[1]))
                    {
                        return Err("Le plus petit gradin atelier ne contient pas les murs et l'accès vertical déclarés.".into());
                    }
                }
                body.arms = arms(std::slice::from_ref(body.levels.last().unwrap()));
            }
            if p.footprint_family == "FP-MULTICELL" {
                body.cells = vec![StructuralCell {
                    id: format!("workshop-cell-{}", out.bodies.len()),
                    footprint: body.footprint.clone(),
                    floors: p.floors[0],
                    household_id: None,
                }];
            }
            out.bodies.push(body);
        }
    }
    let occupied = unite(
        &out.bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    out.courts = difference(&out.courts, &occupied);
    if !out.courts.is_empty() {
        let c = center(&out.courts);
        out.paths = difference(&segment_strip(c, point(w * 0.5, d + 6.0), 1.4), &occupied);
    }
    if p.footprint_family == "FP-ROCKCUT" {
        for body in &mut out.bodies {
            body.z = -2.4;
            body.parameters.envelope = crate::catalogue::Envelope::Rockcut;
            body.parameters.vertical_access = VerticalAccess::ExteriorStair;
        }
        out.features.push(feature(
            "workshop-excavation",
            FeatureKind::Excavation,
            rectangle(0.0, 0.0, w, d),
            -2.4,
            2.4,
            "MAT-ROCKCUT",
        ));
    }
    if p.support.kind == SupportKind::Raft {
        out.context.push(feature(
            "workshop-water",
            FeatureKind::Water,
            rectangle(-4.0, -4.0, w + 8.0, d + 8.0),
            -0.3,
            0.0,
            "",
        ));
    }
    out.context.push(feature(
        "street",
        FeatureKind::Street,
        rectangle(-6.0, d + 3.0, w + 12.0, 3.0),
        0.0,
        0.0,
        "",
    ));
    Ok(out)
}

fn high_hall(p: &Parameters, role: Role, out: &mut LayoutPlan) -> Result<[f64; 2], String> {
    let h = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.high_hall.as_ref())
        .ok_or("Salle haute sans programme structurel.")?;
    let count = p.bodies[0] as usize;
    if !(3..=5).contains(&count) || role != Role::Dwelling || p.overhang_m != [0.0; 2] {
        return Err(
            "Salle haute : 3–5 corps du même logement et joints sans débord requis.".into(),
        );
    }
    let mut core = p.clone();
    core.components.clear();
    core.bodies = [1; 2];
    core.footprint_family = "FP-RECT".into();
    core.level_height_m = h.core_level_height_m;
    let mut wing = core.clone();
    wing.level_height_m = p.level_height_m;
    let room_width = |cp: &Parameters| {
        let n = cp.rooms_per_body[0].max(1) as f64;
        2.0 * cp.wall_thickness_m[0] + n * 1.4 + (n - 1.0) * cp.wall_thickness_m[0] * 0.5
    };
    let core_min = minimum_domain(&core);
    let wing_min = minimum_domain(&wing);
    let extra_north = usize::from(count >= 4);
    let extra_south = usize::from(count >= 5);
    let cw = (p.width_m[0] / 3.0)
        .max(core_min[0])
        .max(room_width(&core))
        .max(h.passage_width_m + 2.0 * p.wall_thickness_m[0]);
    let cd = (p.depth_m[0] / (1 + extra_north + extra_south) as f64).max(core_min[1]);
    let ew = (p.width_m[0] / 3.0).max(wing_min[0]).max(room_width(&wing));
    let ns = wing_min[1];
    let x = ew;
    let y = ns * extra_north as f64;
    let mut body = spec(rectangle(x, y, cw, cd), &core, role);
    body.component = Some("nile_core".into());
    out.bodies.push(body);
    for placement in h.wing_order.iter().take(count - 1) {
        let (name, surface) = match placement {
            Placement::East => ("east", rectangle(x + cw, y, ew, cd)),
            Placement::West => ("west", rectangle(0.0, y, ew, cd)),
            Placement::North => ("north", rectangle(x, 0.0, cw, ns)),
            Placement::South => ("south", rectangle(x, y + cd, cw, ns)),
            _ => return Err("Salle haute : aile sans façade commune avec noyau.".into()),
        };
        let mut body = spec(surface, &wing, role);
        body.component = Some(format!("nile_wing_{name}"));
        out.bodies.push(body);
    }
    let size = [cw + 2.0 * ew, cd + (extra_north + extra_south) as f64 * ns];
    out.diagnostics.push(format!("Salle haute nilotique : enveloppe {:.3} × {:.3} m au lieu de {:.3} × {:.3} m, {count} corps jointifs entiers, {} niveaux communs, noyau {:.3} m/niveau et ailes {:.3} m/niveau ; dimensions stylized, pièces et vrais accès conservés.",size[0],size[1],p.width_m[0],p.depth_m[0],p.floors[0],h.core_level_height_m,p.level_height_m));
    Ok(size)
}

/// Main-body count is separate from attached components and structural cells.
pub(crate) fn build_layout(
    recipe: &Recipe,
    p: &Parameters,
    seed: &str,
) -> Result<LayoutPlan, String> {
    let mut rng = Rng::new(seed).fork("components");
    let mut w = p.width_m[0];
    let mut d = p.depth_m[0];
    let count = p.bodies[0].max(1) as usize;
    let initial = [w, d];
    let mut out = LayoutPlan {
        lot: vec![],
        courts: vec![],
        paths: vec![],
        bodies: vec![],
        features: vec![],
        context: vec![],
        diagnostics: vec![],
    };
    let minimum = minimum_domain(p);
    if matches!(p.layout, Layout::HutCompound | Layout::Kraal) {
        let diameter = minimum[0].max(minimum[1]);
        let orbit = diameter / (2.0 * libm::sin(PI / count.max(3) as f64) * 0.8);
        w = w.max(orbit / 0.36);
        d = d.max(orbit / 0.36);
    }
    if p.roof_spec
        .shell
        .as_ref()
        .is_some_and(|s| s.profile == ShellProfile::Ogival)
    {
        let diameter = w.max(d);
        if w != d {
            out.diagnostics.push(format!("Coque ogivale : plan rond sourcé, diamètre commun {:.3} m au lieu de {:.3} × {:.3} m ; choix de dimensions stylisé.",diameter,w,d));
        }
        w = diameter;
        d = diameter;
    }
    if matches!(
        p.layout,
        Layout::Courtyard
            | Layout::Peristyle
            | Layout::Atrium
            | Layout::IwanCourt
            | Layout::Excavated
    ) {
        let fraction = (1.0 - libm::sqrt(p.courtyard_ratio[0])) * 0.5;
        w = w.max(minimum[0] / fraction);
        d = d.max(minimum[1] / fraction);
    }
    if p.layout == Layout::Additive && count > 1 {
        w = w.max(minimum[0] * count as f64);
        d = d.max(minimum[1] / 0.65);
    }
    if p.layout == Layout::Kancha {
        // The first three halls occupy the north and side bands. A fourth
        // straddles the entrance; later halls remain separate inside the court.
        w = w.max(minimum[0] / 0.21);
        d = d.max(minimum[1] / 0.22);
        if count >= 4 {
            d = d.max(minimum[1] / 0.2).max(2.8 / 0.08);
        }
        if count > 4 {
            let n = (count - 4) as f64;
            w = w
                .max((n * minimum[0] + (n + 1.0) * 1.4) / 0.58)
                .max((n + 1.0) * 1.4 / 0.18);
            d = d.max(minimum[1] / 0.16).max(1.4 / 0.05);
        }
        // Shared generator coordinates remain on the same millimetre grid.
        // Two extra millimetres leave room for the rounded side-band endpoints.
        w = libm::ceil(w / crate::geometry::GRID_M) * crate::geometry::GRID_M + 0.002;
        d = libm::ceil(d / crate::geometry::GRID_M) * crate::geometry::GRID_M + 0.002;
        out.diagnostics.push(format!("Kancha : bandes et rangée intérieure dimensionnées pour {count} corps distincts, pièces et accès déclarés ; dégagement minimal 1,4 m, étages et comptes conservés."));
    }
    if p.layout == Layout::Multiyard {
        w = w.max(minimum[0] / 0.28);
        d = d.max(minimum[1] * count.div_ceil(2) as f64);
        if let Some(corbel) = &p.roof_spec.corbel
            && corbel.profile == CorbelProfile::Barrel
        {
            let wall = p.wall_thickness_m[0];
            let short = corbel.cap_span_m + 2.0 * (wall * 0.5 - 2.0 * corbel.min_bearing_m);
            if short < 1.4 {
                return Err("La voûte sous terrasse n'admet pas une pièce physique de largeur 1,4 m avec ses appuis.".into());
            }
            let rows = count.div_ceil(2);
            let body_depth = p.rooms_per_body[0] as f64 * (2.6 + 1.5 * wall);
            w = w.max(2.0 * (2.0 * wall + short) + 1.4);
            d = d.max(rows as f64 * body_depth + rows.saturating_sub(1) as f64 * 1.4);
            out.diagnostics.push(format!("Programme de voûtes stylisé : {count} corps rectangulaires, {} pièces entières par corps, portée intérieure {short:.3} m déduite du cap et des appuis ; murs {wall:.3} m, aucun compte réduit.",p.rooms_per_body[0]));
        }
    }
    if p.layout == Layout::Broch
        && let Some(shell) = &p.shell
    {
        let diameter = shell.inner_diameter_m
            + 2.0 * (shell.outer_wall_m + shell.gallery_m + shell.inner_wall_m);
        w = w.max(diameter);
        d = d.max(diameter);
    }
    if matches!(p.layout, Layout::Parallel | Layout::Cliff) {
        w = w.max(
            (minimum[0]
                + if p.layout == Layout::Parallel {
                    0.7
                } else {
                    0.0
                })
                * count as f64,
        );
        d = d.max(minimum[1] / 0.75);
    }
    if [w, d] != initial {
        out.diagnostics.push(format!("Dimensions graphiques ajustées de {:.3} × {:.3} à {:.3} × {:.3} m pour {} corps, murs et accès déclarés ; aucune quantité réduite.",initial[0],initial[1],w,d,count));
    }
    if p.structural_spec
        .as_ref()
        .is_some_and(|s| s.lattice.is_some())
    {
        if p.layout != Layout::Single || p.footprint_family != "FP-ROUND" {
            return Err("Treillis : enceinte unique sur plan circulaire requise.".into());
        }
        let diameter = w.max(d);
        if (w - d).abs() > 0.000_001 {
            out.diagnostics.push(format!("Cylindre de treillis : dimensions graphiques {:.3} × {:.3} → cercle de diamètre {:.3} m, plan circulaire source conservé.",w,d,diameter));
        }
        w = diameter;
        d = diameter;
    }
    if p.roof_system == "uncovered" {
        spatial(recipe, p, w, d, &mut out)?;
    } else if let Some(program) = &p.court_program
        && p.layout == Layout::Multiyard
    {
        [w, d] = ranked_courts(p, program, recipe.role, seed, [w, d], &mut out)?;
    } else if let Some(program) = &p.court_program
        && p.layout == Layout::IwanCourt
        && program.iwans.is_some()
    {
        iwan_court(p, program, recipe.role, w, d, &mut out)?;
    } else {
        match p.layout {
            Layout::HighHall => {
                [w, d] = high_hall(p, recipe.role, &mut out)?;
            }
            Layout::Single | Layout::Platform => {
                let body = primitive_spec(&p.footprint_family, w, d, seed, p, recipe.role)?;
                out.courts = difference(&rectangle(0.0, 0.0, w, d), &body.footprint);
                out.bodies.push(body);
            }
            Layout::Strip => {
                let corridor = 1.25;
                let rear = d * 0.25;
                out.courts = rectangle(0.0, 0.0, w, rear);
                out.paths = rectangle(w - corridor, 0.0, corridor, d);
                out.bodies.push(spec(
                    rectangle(0.0, rear, w - corridor, d - rear),
                    p,
                    recipe.role,
                ));
            }
            Layout::Courtyard
            | Layout::Peristyle
            | Layout::Atrium
            | Layout::IwanCourt
            | Layout::Excavated => {
                out.courts = reserve_court(w, d, p.courtyard_ratio[0]);
                let b = bounds(&out.courts);
                out.paths = rectangle(w * 0.5 - 0.8, b[3], 1.6, d - b[3] + 0.001);
                let domains = vec![
                    rectangle(0.0, 0.0, w, b[1]),
                    rectangle(0.0, b[3], w, d - b[3]),
                    rectangle(0.0, b[1], b[0], b[3] - b[1]),
                    rectangle(b[2], b[1], w - b[2], b[3] - b[1]),
                ];
                for (i, s) in domains.into_iter().enumerate() {
                    if p.footprint_family == "FP-U" && i == 1 {
                        continue;
                    }
                    if p.footprint_family == "FP-L" && (i == 1 || i == 3) {
                        continue;
                    }
                    let mut body = spec(s.clone(), p, recipe.role);
                    if i == 1 {
                        body.levels[0] = difference(&s, &out.paths);
                        body.footprint = body.levels[0].clone();
                    }
                    out.bodies.push(body);
                }
                if matches!(
                    p.layout,
                    Layout::Peristyle | Layout::Atrium | Layout::IwanCourt
                ) {
                    let gallery =
                        difference(&out.courts, &offset(&out.courts, -p.gallery_cover.width_m));
                    out.features.push(feature(
                        "court-gallery",
                        FeatureKind::Gallery,
                        gallery.clone(),
                        if p.layout == Layout::Excavated {
                            -2.4
                        } else {
                            0.0
                        },
                        2.7,
                        &p.materials.frame,
                    ));
                    out.paths = union(&out.paths, &gallery);
                    if p.layout == Layout::Atrium {
                        out.features.push(feature(
                            "impluvium",
                            FeatureKind::Impluvium,
                            rectangle(w * 0.5 - 1.0, d * 0.5 - 1.0, 2.0, 2.0),
                            -0.25,
                            0.25,
                            &p.materials.infill,
                        ));
                    }
                }
            }
            Layout::Siheyuan | Layout::Kancha | Layout::Shinden => {
                out.courts = reserve_court(w, d, p.courtyard_ratio[0].max(0.3));
                let gap = if p.layout == Layout::Kancha { 1.4 } else { 1.3 };
                let north_depth = d * 0.22;
                let north_width = w * 0.68;
                let slots = if p.layout == Layout::Shinden {
                    vec![
                        rectangle(w * 0.25, d * 0.2, w * 0.5, d * 0.24),
                        rectangle(0.0, d * 0.12, w * 0.2, d * 0.52),
                        rectangle(w * 0.8, d * 0.12, w * 0.2, d * 0.52),
                    ]
                } else {
                    vec![
                        rectangle((w - north_width) * 0.5, 0.0, north_width, north_depth),
                        rectangle(0.0, north_depth + gap, w * 0.21, d * 0.5),
                        rectangle(w * 0.79, north_depth + gap, w * 0.21, d * 0.5),
                        rectangle(w * 0.2, d * 0.8, w * 0.6, d * 0.2),
                    ]
                };
                for (i, s) in slots.into_iter().enumerate() {
                    let mut body = spec(s.clone(), p, recipe.role);
                    if i == 3 {
                        body.levels[0] =
                            difference(&s, &rectangle(w * 0.5 - 0.8, d * 0.8, 1.6, d * 0.2 + 0.01));
                        body.footprint = body.levels[0].clone();
                    }
                    out.bodies.push(body);
                }
                out.paths = rectangle(w * 0.5 - 0.8, d * 0.5, 1.6, d * 0.5);
                if p.layout == Layout::Kancha {
                    let n = count.saturating_sub(4).max(1);
                    let cw = (libm::floor(w * 0.4 / n as f64 / crate::geometry::GRID_M)
                        * crate::geometry::GRID_M)
                        .max(
                            libm::ceil(minimum[0] / crate::geometry::GRID_M)
                                * crate::geometry::GRID_M,
                        );
                    let row_width = n as f64 * cw + n.saturating_sub(1) as f64 * 1.4;
                    let start = point((w - row_width) * 0.5, d * 0.27);
                    while out.bodies.len() < count {
                        let i = out.bodies.len() - 4;
                        out.bodies.push(spec(
                            rectangle(start.x + i as f64 * (cw + 1.4), start.y, cw, d * 0.16),
                            p,
                            recipe.role,
                        ));
                    }
                    out.bodies.truncate(count);
                    for (i, body) in out.bodies.iter().enumerate() {
                        for other in out.bodies.iter().skip(i + 1) {
                            if area(&intersection(
                                &offset(&body.footprint, 0.7),
                                &offset(&other.footprint, 0.7),
                            )) > 0.000_001
                            {
                                return Err(format!(
                                    "Kancha : corps {i} sans dégagement de 1,4 m après placement ; aucune quantité réduite."
                                ));
                            }
                        }
                    }
                }
                if p.layout == Layout::Shinden {
                    let galleries = union(
                        &rectangle(w * 0.18, d * 0.37, w * 0.64, 1.2),
                        &rectangle(w * 0.18, d * 0.12, 1.2, d * 0.52),
                    );
                    out.features.push(feature(
                        "shinden-galleries",
                        FeatureKind::Gallery,
                        galleries.clone(),
                        p.support.height_m[0],
                        2.6,
                        &p.materials.frame,
                    ));
                    out.paths = union(&out.paths, &galleries);
                }
            }
            Layout::HutCompound | Layout::Kraal => {
                let shape = primitive_with_options(
                    "FP-CLUSTER-ROUND",
                    w,
                    d,
                    seed,
                    PrimitiveOptions {
                        bodies: count as u32,
                        courtyard_ratio: p.courtyard_ratio[0],
                        tiers: 1,
                    },
                )?;
                out.courts = shape.courts;
                for s in shape.body_domains {
                    out.bodies.push(spec(s, p, recipe.role));
                }
                if p.layout == Layout::Kraal {
                    out.features.push(feature(
                        "central-livestock-pen",
                        FeatureKind::LivestockPen,
                        offset(&out.courts, -1.0),
                        0.0,
                        1.5,
                        &p.materials.infill,
                    ));
                }
            }
            Layout::Multiyard => {
                let yards = if p.details.iter().any(|t| t == "three_hierarchical_courts") {
                    3
                } else {
                    2
                };
                let mut holes = vec![];
                for i in 0..yards {
                    holes.push(rectangle(
                        w * 0.28,
                        d * (i as f64 + 0.22) / yards as f64,
                        w * 0.44,
                        d * 0.56 / yards as f64,
                    ));
                }
                out.courts = unite(&holes);
                out.paths = rectangle(w * 0.5 - 0.8, 0.0, 1.6, d);
                let occupied = difference(
                    &difference(&rectangle(0.0, 0.0, w, d), &out.courts),
                    &out.paths,
                );
                let n = count;
                if let Some(corbel) = &p.roof_spec.corbel
                    && corbel.profile == CorbelProfile::Barrel
                {
                    let wall = p.wall_thickness_m[0];
                    let short = corbel.cap_span_m + 2.0 * (wall * 0.5 - 2.0 * corbel.min_bearing_m);
                    let body_width = 2.0 * wall + short;
                    let rows = n.div_ceil(2);
                    let body_depth = (d - rows.saturating_sub(1) as f64 * 1.4) / rows as f64;
                    for i in 0..n {
                        let x = if i % 2 == 0 { 0.0 } else { w - body_width };
                        let y = (i / 2) as f64 * (body_depth + 1.4);
                        let mut body =
                            spec(rectangle(x, y, body_width, body_depth), p, recipe.role);
                        let rooms = p.rooms_per_body[0];
                        body.cells = (0..rooms)
                            .map(|r| StructuralCell {
                                id: format!("vault-room-{i}-{r}"),
                                footprint: rectangle(
                                    x,
                                    y + r as f64 * body_depth / rooms as f64,
                                    body_width,
                                    body_depth / rooms as f64,
                                ),
                                floors: 1,
                                household_id: None,
                            })
                            .collect();
                        out.bodies.push(body);
                    }
                } else {
                    for i in 0..n {
                        let cell = intersection(
                            &occupied,
                            &rectangle(
                                (i % 2) as f64 * w * 0.5,
                                (i / 2) as f64 * d / (n.div_ceil(2)) as f64,
                                w * 0.5,
                                d / (n.div_ceil(2)) as f64,
                            ),
                        );
                        if area(&cell) <= 1.0 {
                            return Err(format!(
                                "Corps multiyard {i} trop petit ; {n} demandés, aucune réduction autorisée."
                            ));
                        }
                        out.bodies.push(spec(cell, p, recipe.role));
                    }
                }
            }
            Layout::Pueblo | Layout::GreatHouse => {
                let cells = p.cells[0] as usize;
                let complete_program = p.components.len() > 1
                    && p.components
                        .iter()
                        .any(|c| c.role.residential() && c.placement != Placement::FacingMain);
                let groups = if complete_program { 1 } else { count };
                if groups > cells {
                    return Err(format!(
                        "{groups} corps principaux pour seulement {cells} cellules."
                    ));
                }
                let prior = [w, d];
                let hatch = private_cell_hatch(p);
                let (cw, cd, courts, gate, mut domains) = whole_cells(p, w, d, cells, seed, hatch)?;
                w = cw;
                d = cd;
                out.courts = courts;
                out.paths = gate;
                if [w, d] != prior {
                    let hatch_note = if let Some((width, run)) = hatch {
                        let legacy = whole_cells(p, prior[0], prior[1], cells, seed, None)?;
                        if [legacy.0, legacy.1] != [w, d] {
                            format!(" et une trémie {width:.3} × {run:.3} m")
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };
                    out.diagnostics.push(format!("Dimensions cellulaires ajustées de {:.3} × {:.3} à {:.3} × {:.3} m pour conserver exactement {cells} cellules entières et leurs murs{hatch_note}.",prior[0],prior[1],w,d));
                }
                domains.sort_by(|a, b| {
                    let a = center(a);
                    let b = center(b);
                    libm::atan2(a.y - d * 0.5, a.x - w * 0.5)
                        .total_cmp(&libm::atan2(b.y - d * 0.5, b.x - w * 0.5))
                });
                let mut grouped: Vec<Vec<StructuralCell>> = vec![vec![]; groups];
                for (i, cell) in domains.into_iter().enumerate() {
                    let c = center(&cell);
                    let distance =
                        ((c.x - w * 0.5).abs() / (w * 0.5)).max((c.y - d * 0.5).abs() / (d * 0.5));
                    let floors = 1
                        + (libm::floor(distance * p.floors[0].saturating_sub(1) as f64) as u32)
                            .min(p.floors[0] - 1);
                    grouped[i * groups / cells].push(StructuralCell {
                        id: format!("cell-{i}"),
                        footprint: cell,
                        floors,
                        household_id: Some(format!("household-{i}")),
                    });
                }
                for group in grouped {
                    let surface = unite(
                        &group
                            .iter()
                            .map(|c| c.footprint.clone())
                            .collect::<Vec<_>>(),
                    );
                    let mut body = spec(surface, p, recipe.role);
                    body.levels = (0..p.floors[0])
                        .map(|level| {
                            unite(
                                &group
                                    .iter()
                                    .filter(|c| c.floors > level)
                                    .map(|c| c.footprint.clone())
                                    .collect::<Vec<_>>(),
                            )
                        })
                        .take_while(|s| !s.is_empty())
                        .collect();
                    body.arms = arms(
                        &group
                            .iter()
                            .map(|c| c.footprint.clone())
                            .collect::<Vec<_>>(),
                    );
                    body.cells = group;
                    out.bodies.push(body);
                }
            }
            Layout::Ring => {
                let n = p.cells[0] as usize;
                if n < 5 {
                    return Err(
                        "Anneau habité sans nombre de cellules cohérent (minimum cinq).".into(),
                    );
                }
                let prior = [w, d];
                let inner = libm::sqrt(p.courtyard_ratio[0]);
                let minimum = 2.4_f64.max(p.wall_thickness_m[0] + 1.4);
                let (court, gallery, cells, ring_arms) = loop {
                    if p.footprint_family == "FP-COURT" {
                        let partition = rectangular_ring_cells(
                            w,
                            d,
                            p.courtyard_ratio[0],
                            n,
                            p.gallery_cover.width_m,
                        )?;
                        let largest = partition
                            .cells
                            .iter()
                            .map(|c| area(&c.footprint))
                            .fold(0.0_f64, f64::max);
                        let smallest = partition
                            .cells
                            .iter()
                            .map(|c| area(&c.footprint))
                            .fold(f64::INFINITY, f64::min);
                        if largest / smallest <= 2.5
                            && partition.cells.iter().all(|cell| {
                                let inner_width = libm::hypot(
                                    cell.inner_edge[1].x - cell.inner_edge[0].x,
                                    cell.inner_edge[1].y - cell.inner_edge[0].y,
                                );
                                let outer_width = libm::hypot(
                                    cell.outer_edge[1].x - cell.outer_edge[0].x,
                                    cell.outer_edge[1].y - cell.outer_edge[0].y,
                                );
                                inner_width >= minimum
                                    && (inner_width + outer_width) * 0.5 >= minimum
                            })
                        {
                            break (
                                partition.court,
                                partition.gallery,
                                partition.cells.into_iter().map(|c| c.footprint).collect(),
                                partition.arms,
                            );
                        }
                    } else {
                        let hole = ellipse(w * 0.5, d * 0.5, w * inner * 0.5, d * inner * 0.5, 128);
                        let court = offset(&hole, -p.gallery_cover.width_m);
                        let gallery = difference(&hole, &court);
                        let gate_angle =
                            2.0 * libm::asin((0.8 / (w.min(d) * inner * 0.5)).min(0.8));
                        let start = PI * 0.5 + gate_angle * 0.5;
                        let span = TAU - gate_angle;
                        let mut cells = vec![];
                        let mut ring_arms = vec![];
                        for i in 0..n {
                            let a = start + span * i as f64 / n as f64;
                            let b = start + span * (i + 1) as f64 / n as f64;
                            let cell = ring_sector(w, d, inner, a, b, 8);
                            let mid = (a + b) * 0.5;
                            let tangent = [-w * libm::sin(mid), d * libm::cos(mid)];
                            let length = libm::hypot(tangent[0], tangent[1]);
                            ring_arms
                                .push(axis_arm(&cell, [tangent[0] / length, tangent[1] / length]));
                            cells.push(cell);
                        }
                        if ring_arms
                            .iter()
                            .all(|a| a.length_m.min(a.width_m) >= minimum)
                        {
                            break (court, gallery, cells, ring_arms);
                        }
                    }
                    w *= 1.15;
                    d *= 1.15;
                    if w > 1000.0 || d > 1000.0 {
                        return Err(format!(
                            "Impossible de garder {n} cellules annulaire entières de {minimum:.3} m."
                        ));
                    }
                };
                if [w, d] != prior {
                    out.diagnostics.push(format!("Anneau ajusté de {:.3} × {:.3} à {:.3} × {:.3} m pour {n} cellules exactes de largeur ≥ {minimum:.3} m.",prior[0],prior[1],w,d));
                }
                let gate = rectangle(w * 0.5 - 0.8, d * 0.5, 1.6, d * 0.5 + 0.01);
                // Cells author the partitions; the source envelope remains the
                // continuous annulus. Union rounding at diagonal cell joints
                // must never create false roof eaves between households.
                let surface = if p.footprint_family == "FP-COURT" {
                    difference(
                        &difference(
                            &rectangle(0.0, 0.0, w, d),
                            &reserve_court(w, d, p.courtyard_ratio[0]),
                        ),
                        &gate,
                    )
                } else {
                    let gate_angle = 2.0 * libm::asin((0.8 / (w.min(d) * inner * 0.5)).min(0.8));
                    let start = PI * 0.5 + gate_angle * 0.5;
                    // One authored C-shaped polygon with the very same arc
                    // samples as the sectors, rather than a boolean cell union.
                    ring_sector(w, d, inner, start, start + TAU - gate_angle, n * 8)
                };
                let mut body = spec(surface, p, recipe.role);
                body.cells = cells
                    .into_iter()
                    .enumerate()
                    .map(|(i, footprint)| StructuralCell {
                        id: format!("ring-cell-{i}"),
                        footprint,
                        floors: p.floors[0],
                        household_id: Some(format!("household-{i}")),
                    })
                    .collect();
                body.arms = ring_arms;
                for l in 0..p.floors[0] {
                    out.features.push(feature(
                        &format!("inner-gallery-{l}"),
                        FeatureKind::Gallery,
                        gallery.clone(),
                        l as f64 * p.level_height_m,
                        0.18,
                        &p.materials.frame,
                    ));
                }
                // The authored C gap is a passage, not a native gateway. Its
                // transverse masonry has actual jambages and is cut by access.
                if let Some(profile) = &p.site_gate_profile {
                    let thickness = p.wall_thickness_m[0];
                    let gap_width = if p.footprint_family == "FP-COURT" {
                        1.6
                    } else {
                        w * (0.8 / (w.min(d) * inner * 0.5)).min(0.8)
                    };
                    let height = profile
                        .entries
                        .iter()
                        .map(|e| e.head_m + 0.15)
                        .fold(p.level_height_m, f64::max);
                    out.features.push(feature(
                        "source-ring-gateway",
                        FeatureKind::Enclosure,
                        rectangle(
                            w * 0.5 - gap_width * 0.5 - thickness,
                            d - thickness * 1.5,
                            gap_width + thickness * 2.0,
                            thickness,
                        ),
                        0.0,
                        height,
                        &p.materials.infill,
                    ));
                    out.diagnostics.push(format!(
                        "Portail annulaire : mur transversal réel de {:.3} m, hauteur {:.3} m, jambages ancrés dans l'anneau ; passage profilé par accès.", thickness, height
                    ));
                }
                out.courts = court;
                out.paths = union(&gate, &gallery);
                out.bodies.push(body);
            }
            Layout::Broch => {
                let shell = p
                    .shell
                    .as_ref()
                    .ok_or("Broch sans paramètres de double coque.")?;
                let diameter = shell.inner_diameter_m;
                let inner = ellipse(w * 0.5, d * 0.5, diameter * 0.5, diameter * 0.5, 96);
                let inner_wall = difference(&offset(&inner, shell.inner_wall_m), &inner);
                let gallery = difference(
                    &offset(&inner, shell.inner_wall_m + shell.gallery_m),
                    &offset(&inner, shell.inner_wall_m),
                );
                let outer_wall = difference(
                    &offset(
                        &inner,
                        shell.inner_wall_m + shell.gallery_m + shell.outer_wall_m,
                    ),
                    &offset(&inner, shell.inner_wall_m + shell.gallery_m),
                );
                let gate = rectangle(w * 0.5 - 0.75, d * 0.5, 1.5, d * 0.65);
                out.features.push(feature(
                    "broch-inner-wall",
                    FeatureKind::Enclosure,
                    difference(&inner_wall, &gate),
                    0.0,
                    p.floors[0] as f64 * p.level_height_m,
                    &p.materials.frame,
                ));
                for (name, wall) in [("inner", &inner_wall), ("outer", &outer_wall)] {
                    out.features.push(feature(
                        &format!("broch-{name}-lintel"),
                        FeatureKind::Enclosure,
                        intersection(wall, &gate),
                        2.05,
                        p.floors[0] as f64 * p.level_height_m - 2.05,
                        &p.materials.frame,
                    ));
                }
                out.features.push(feature(
                    "broch-outer-wall",
                    FeatureKind::Enclosure,
                    difference(&outer_wall, &gate),
                    0.0,
                    p.floors[0] as f64 * p.level_height_m,
                    &p.materials.frame,
                ));
                for l in 0..p.floors[0] {
                    out.features.push(feature(
                        &format!("broch-gallery-{l}"),
                        FeatureKind::Gallery,
                        gallery.clone(),
                        l as f64 * p.level_height_m,
                        0.2,
                        &p.materials.frame,
                    ));
                }
                let mut body = spec(inner, p, recipe.role);
                body.parameters.wall_thickness_m = [0.4, 0.4];
                out.paths = union(&gate, &gallery);
                out.bodies.push(body);
            }
            Layout::Cliff => {
                let n = count.max(1);
                let gap = 0.0;
                for i in 0..n {
                    out.bodies.push(spec(
                        rectangle(i as f64 * w / n as f64, 0.0, w / n as f64 - gap, d * 0.75),
                        p,
                        recipe.role,
                    ));
                }
                let shelter = rectangle(-1.0, -2.0, w + 2.0, d * 0.9);
                let ceiling = p.floors[0] as f64 * p.level_height_m + 1.0;
                let mut f = feature(
                    "rock-shelter",
                    FeatureKind::RockShelter,
                    shelter,
                    ceiling,
                    2.0,
                    "MAT-ROCKCUT",
                );
                f.vertices3d = f.surface[0]
                    .outer
                    .iter()
                    .map(|q| Vertex3 {
                        x: q.x,
                        y: q.y,
                        z: ceiling,
                    })
                    .collect();
                out.context.push(f);
                out.context.push(feature(
                    "rock-front",
                    FeatureKind::RockFace,
                    rectangle(-2.0, -3.0, w + 4.0, 3.0),
                    0.0,
                    ceiling + 2.0,
                    "MAT-ROCKCUT",
                ));
                out.paths = rectangle(0.0, d * 0.75, w, 1.4);
            }
            Layout::Parallel => {
                let corridor = 1.4;
                for i in 0..count {
                    out.bodies.push(spec(
                        rectangle(
                            i as f64 * w / count as f64,
                            corridor,
                            w / count as f64 - 0.7,
                            d - corridor,
                        ),
                        p,
                        recipe.role,
                    ));
                }
                out.paths = rectangle(0.0, 0.0, w, corridor);
                out.features.push(feature(
                    "connecting-corridor",
                    FeatureKind::Gallery,
                    out.paths.clone(),
                    -2.4,
                    2.6,
                    &p.materials.frame,
                ));
            }
            Layout::Bridge => {
                let bank = w * 0.29;
                out.bodies
                    .push(spec(rectangle(0.0, 0.0, bank, d), p, recipe.role));
                out.bodies
                    .push(spec(rectangle(w - bank, 0.0, bank, d), p, recipe.role));
                out.paths = rectangle(bank, 0.0, w - 2.0 * bank, d);
                out.features.push(feature(
                    "bridge-deck",
                    FeatureKind::Deck,
                    rectangle(0.0, 0.0, w, d),
                    p.support.height_m[0],
                    0.35,
                    &p.materials.frame,
                ));
                out.context.push(feature(
                    "bridge-water",
                    FeatureKind::Water,
                    rectangle(-4.0, d * 0.2, w + 8.0, d * 0.6),
                    -0.7,
                    0.0,
                    "",
                ));
            }
            Layout::Additive => {
                if count == 1 {
                    out.bodies.push(primitive_spec(
                        &p.footprint_family,
                        w,
                        d,
                        seed,
                        p,
                        recipe.role,
                    )?);
                } else {
                    let cell_width = w / count as f64;
                    for i in 0..count {
                        let height = d * (0.65 + 0.35 * (i % 2) as f64);
                        out.bodies.push(spec(
                            rectangle(i as f64 * cell_width, 0.0, cell_width, height),
                            p,
                            recipe.role,
                        ));
                    }
                }
            }
        }
    }
    if p.layout != Layout::HighHall {
        apply_components(p, recipe.role, w, d, &mut rng, &mut out)?;
    }
    lightwells(p, &mut out)?;
    if p.layout == Layout::Shinden && !p.components.is_empty() {
        out.features.retain(|f| f.id != "shinden-galleries");
        out.paths.clear();
        if let Some(central) = out
            .bodies
            .iter()
            .find(|b| b.component.as_deref() == Some("central_hall"))
        {
            let central_bounds = bounds(&central.footprint);
            let center = point(
                (central_bounds[0] + central_bounds[2]) * 0.5,
                (central_bounds[1] + central_bounds[3]) * 0.5,
            );
            let z = central.z;
            for (index, side) in out
                .bodies
                .iter()
                .filter(|b| b.component.as_deref() == Some("side_halls"))
                .enumerate()
            {
                let side_bounds = bounds(&side.footprint);
                let target = point(
                    (side_bounds[0] + side_bounds[2]) * 0.5,
                    (side_bounds[1] + side_bounds[3]) * 0.5,
                );
                let a = boundary_anchor(center, target, central_bounds);
                let b = boundary_anchor(target, center, bounds(&side.footprint));
                let surface = difference(
                    &segment_strip(a, b, 1.2),
                    &unite(
                        &out.bodies
                            .iter()
                            .map(|body| body.footprint.clone())
                            .collect::<Vec<_>>(),
                    ),
                );
                out.paths = union(&out.paths, &surface);
                out.features.push(feature(
                    &format!("shinden-gallery-{index}"),
                    FeatureKind::Gallery,
                    surface,
                    z,
                    2.7,
                    &p.materials.roof_frame,
                ));
            }
        }
    }
    shared_raised_platform(p, &mut out)?;
    if let Some(retaining) = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.retaining.as_ref())
    {
        if retaining.terrace_rise_m <= 0.0 || retaining.base_depth_m <= 0.0 {
            return Err("Gradins : cotes du remblai/terrasses non positives.".into());
        }
        let mut rows: Vec<_> = out
            .bodies
            .iter()
            .filter(|b| b.role.residential() && b.parameters.support.kind == SupportKind::Ground)
            .map(|b| bounds(&b.footprint)[1])
            .collect();
        rows.sort_by(|a, b| b.total_cmp(a));
        rows.dedup_by(|a, b| (*a - *b).abs() < 0.001);
        for body in out
            .bodies
            .iter_mut()
            .filter(|b| b.role.residential() && b.parameters.support.kind == SupportKind::Ground)
        {
            let y = bounds(&body.footprint)[1];
            let rank = rows.iter().position(|r| (*r - y).abs() < 0.001).unwrap();
            body.z = rank as f64 * retaining.terrace_rise_m;
        }
        out.diagnostics.push(format!("Gradins remblayés : {} corps entiers sur {} rangées de paliers, dénivelé {:.3} m par rangée vers le nord ; greniers sur leurs propres pilotis conservés, dimensions stylized, aucun étage/cellule diminué.",out.bodies.len(),rows.len(),retaining.terrace_rise_m));
    }
    authored_island(p, &mut out)?;
    street_jetty(&mut out);
    let occupied = unite(
        &out.bodies
            .iter()
            .map(|b| b.levels[0].clone())
            .collect::<Vec<_>>(),
    );
    out.courts = difference(&out.courts, &occupied);
    compartmented_court(p, &mut out)?;
    let all = union(
        &occupied,
        &unite(
            &out.features
                .iter()
                // Ranked barriers end at the already declared enclosure.
                // They do not enlarge the plot on which that enclosure sits.
                .filter(|f| !f.id.starts_with("court-threshold-"))
                .map(|f| f.surface.clone())
                .collect::<Vec<_>>(),
        ),
    );
    let b = if all.is_empty() {
        [0.0, 0.0, w, d]
    } else {
        bounds(&all)
    };
    out.lot = rectangle(
        b[0] - 6.0,
        b[1] - 6.0,
        (b[2] - b[0]) + 12.0,
        (b[3] - b[1]) + 12.0,
    );
    out.paths = difference(&out.paths, &occupied);
    if p.layout == Layout::Excavated {
        out.features.push(feature(
            "excavation",
            FeatureKind::Excavation,
            rectangle(0.0, 0.0, w, d),
            -2.4,
            2.4,
            "MAT-ROCKCUT",
        ));
    }
    if p.details.iter().any(|s| s == "party_walls") && matches!(p.layout, Layout::Strip) {
        for (i, x) in [0.0, w - 1.25].into_iter().enumerate() {
            out.context.push(feature(
                &format!("party-neighbor-{i}"),
                FeatureKind::Neighbor,
                rectangle(x + if i == 0 { -4.0 } else { 0.0 }, d * 0.25, 4.0, d * 0.75),
                0.0,
                p.floors[0] as f64 * p.level_height_m,
                &p.materials.infill,
            ));
            out.features.push(feature(
                &format!("party-side-{i}"),
                FeatureKind::PartyWall,
                rectangle(x - 0.1, d * 0.25, 0.2, d * 0.75),
                0.0,
                p.floors[0] as f64 * p.level_height_m,
                &p.materials.frame,
            ));
        }
    }
    let lb = bounds(&out.lot);
    out.context.push(feature(
        "street",
        FeatureKind::Street,
        rectangle(lb[0], lb[3] - 3.0, lb[2] - lb[0], 3.0),
        0.0,
        0.0,
        "",
    ));
    Ok(out)
}

fn compartmented_court(p: &Parameters, out: &mut LayoutPlan) -> Result<(), String> {
    let Some(program) = p.court_program.as_ref().filter(|c| c.compartments > 0) else {
        return Ok(());
    };
    if p.layout != Layout::Courtyard || program.compartments != 2 || program.courts.len() != 1 {
        return Err(
            "Cour compartimentée : seul le programme fermé à deux poches latérales est défini."
                .into(),
        );
    }
    let court = out
        .courts
        .iter()
        .max_by(|a, b| area(&vec![(*a).clone()]).total_cmp(&area(&vec![(*b).clone()])))
        .ok_or("Cour compartimentée sans domaine public réel.")?;
    let domain = vec![court.clone()];
    let cb = bounds(&domain);
    let t = program.threshold.wall_m;
    let gate = program.threshold.width_m;
    let span = program.portico.as_ref().map_or(0.0, |s| s.span_m);
    let pocket_width = (cb[2] - cb[0] - gate) * 0.5 - 0.4;
    let pocket_depth = (cb[3] - cb[1]) * 0.4;
    if pocket_width < gate + 2.0 * t + 0.4 || pocket_depth < span + 2.0 * t + 1.4 {
        return Err("Cour compartimentée : domaines insuffisants pour deux poches, portiques et axe public de 1,6 m ; aucune pièce ni poche supprimée.".into());
    }
    for (i, x) in [cb[0] + 0.2, cb[2] - 0.2 - pocket_width]
        .into_iter()
        .enumerate()
    {
        let pocket = rectangle(x, cb[1] + 0.2, pocket_width, pocket_depth);
        let interior = rectangle(
            x + t,
            cb[1] + 0.2 + t,
            pocket_width - 2.0 * t,
            pocket_depth - 2.0 * t,
        );
        let ring = difference(&pocket, &interior);
        if area(&difference(&pocket, &domain)) > 0.000_001
            || area(&intersection(&pocket, &out.paths)) > 0.000_001
        {
            return Err(
                "Cour compartimentée : poche hors domaine libre ou sur l'axe public.".into(),
            );
        }
        out.features.push(feature(
            &format!("court-pocket-{i}"),
            FeatureKind::Courtyard,
            interior.clone(),
            0.0,
            0.0,
            "",
        ));
        // Access excavates a real doorway and its lintel in the native wall.
        // An already open gap would merge both courts into one access node.
        out.features.push(feature(
            &format!("court-pocket-{i}-walls"),
            FeatureKind::Enclosure,
            ring,
            0.0,
            program.threshold.height_m,
            &program.threshold.material,
        ));
        if span > 0.0 {
            let portico = rectangle(x + t, cb[1] + 0.2 + t, pocket_width - 2.0 * t, span);
            out.features.push(feature(
                &format!("court-pocket-{i}-portico"),
                FeatureKind::Gallery,
                portico,
                0.0,
                program.threshold.height_m,
                &p.materials.roof_frame,
            ));
        }
        out.diagnostics.push(format!("Poche de cour {i} : intérieur {:.3} × {:.3} m, mur {:.3} m, passage demandé {:.3} m à excaver dans la paroi native et portique {:.3} m ; nombre 2 et dimensions stylized, corps/pièces inchangés.",pocket_width-2.0*t,pocket_depth-2.0*t,t,gate,span));
    }
    Ok(())
}

fn authored_island(p: &Parameters, out: &mut LayoutPlan) -> Result<(), String> {
    let Some(s) = p.structural_spec.as_ref().and_then(|s| s.island.as_ref()) else {
        return Ok(());
    };
    if s.height_m <= 0.0
        || s.water_depth_m <= 0.0
        || s.pile_depth_m <= s.water_depth_m
        || s.margin_m < 1.4
        || s.pile_spacing_m <= 0.0
        || s.canal_width_m < 1.4
        || !(0.05..=0.45).contains(&s.garden_ratio)
    {
        return Err(
            "Îlot : remblai, profondeur des pieux, marges/canaux ou jardin non physiques.".into(),
        );
    }
    let occupied = unite(
        &out.bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let b = bounds(&occupied);
    let island = rectangle(
        b[0] - s.margin_m,
        b[1] - s.margin_m,
        b[2] - b[0] + s.margin_m * 2.0,
        b[3] - b[1] + s.margin_m * 2.0,
    );
    let outer = offset(&island, s.canal_width_m);
    let ob = bounds(&outer);
    // A real filled crossing, not a floor over the water, joins the south bank.
    let crossing = rectangle(
        (b[0] + b[2]) * 0.5 - 0.8,
        b[3] + s.margin_m,
        1.6,
        s.canal_width_m,
    );
    let fill = union(&island, &crossing);
    let canals = difference(&difference(&outer, &island), &crossing);
    out.context.push(feature(
        "island-canals",
        FeatureKind::Water,
        canals.clone(),
        0.0,
        0.0,
        "",
    ));
    out.features.push(feature(
        "island-canal-cut",
        FeatureKind::Excavation,
        canals,
        -s.water_depth_m,
        s.water_depth_m,
        &s.material,
    ));
    out.features.push(feature(
        "island-fill-main",
        FeatureKind::Retaining,
        island,
        -s.water_depth_m,
        s.height_m + s.water_depth_m,
        &s.material,
    ));
    out.features.push(feature(
        "island-fill-crossing",
        FeatureKind::Retaining,
        crossing,
        -s.water_depth_m,
        s.height_m + s.water_depth_m,
        &s.material,
    ));
    out.features.push(feature(
        "island-public-ground",
        FeatureKind::Deck,
        difference(&fill, &occupied),
        s.height_m,
        0.0,
        &s.material,
    ));
    for body in &mut out.bodies {
        body.z = s.height_m;
    }
    let cols = libm::ceil((b[2] - b[0] + s.margin_m * 2.0) / s.pile_spacing_m) as usize;
    let rows = libm::ceil((b[3] - b[1] + s.margin_m * 2.0) / s.pile_spacing_m) as usize;
    for row in 0..=rows {
        for col in 0..=cols {
            let q = point(
                b[0] - s.margin_m + (b[2] - b[0] + s.margin_m * 2.0) * col as f64 / cols as f64,
                b[1] - s.margin_m + (b[3] - b[1] + s.margin_m * 2.0) * row as f64 / rows as f64,
            );
            out.features.push(feature(
                &format!("island-pile-{col}-{row}"),
                FeatureKind::Post,
                ellipse(q.x, q.y, 0.08, 0.08, 12),
                -s.pile_depth_m,
                s.height_m + s.pile_depth_m,
                &s.pile_material,
            ));
        }
    }
    let free_courts = difference(&difference(&out.courts, &occupied), &out.paths);
    if let Some(court) = free_courts
        .iter()
        .max_by(|a, b| area(&vec![(*a).clone()]).total_cmp(&area(&vec![(*b).clone()])))
    {
        let cb = bounds(&vec![court.clone()]);
        let garden_width = (cb[2] - cb[0]) * s.garden_ratio - 0.4;
        let coordinates: Vec<_> = court
            .outer
            .iter()
            .chain(court.holes.iter().flatten())
            .collect();
        let mut xs: Vec<_> = coordinates.iter().map(|q| q.x).collect();
        let mut ys: Vec<_> = coordinates.iter().map(|q| q.y).collect();
        xs.sort_by(f64::total_cmp);
        xs.dedup_by(|a, b| (*a - *b).abs() < 0.000_001);
        ys.sort_by(f64::total_cmp);
        ys.dedup_by(|a, b| (*a - *b).abs() < 0.000_001);
        let mut garden = vec![];
        for edge in xs {
            for x in [edge + 0.2, edge - 0.2 - garden_width] {
                for (i, y0) in ys.iter().enumerate() {
                    for y1 in ys.iter().skip(i + 1) {
                        if garden_width < 0.5 || y1 - y0 < 0.9 {
                            continue;
                        }
                        let candidate = rectangle(x, y0 + 0.2, garden_width, y1 - y0 - 0.4);
                        if area(&candidate) > area(&garden)
                            && area(&difference(&candidate, &vec![court.clone()])) < 0.000_001
                        {
                            garden = candidate;
                        }
                    }
                }
            }
        }
        if garden.is_empty() {
            return Err("Îlot : aucun jardin rectangulaire entier dans la cour réellement libre, aucune culture supprimée.".into());
        }
        out.diagnostics.push(format!("Jardin de l'îlot : rectangle de {:.3} m², largeur {:.3} de la sous-cour libre moins bordures0.2m ; emprises réelles des corps et axe public exclus.",area(&garden),s.garden_ratio));
        out.features.push(feature(
            "island-garden",
            FeatureKind::Garden,
            garden,
            s.height_m,
            0.0,
            &s.material,
        ));
    } else {
        return Err("Îlot sans jardin rectangulaire libre.".into());
    }
    // The bank crossing descends via a native entry stair built by access.
    out.paths = union(
        &out.paths,
        &rectangle((b[0] + b[2]) * 0.5 - 0.8, b[3], 1.6, ob[3] - b[3]),
    );
    out.diagnostics.push(format!("Îlot remblayé : sol +{:.3} m, fond des canaux -{:.3} m, pieux jusqu'à -{:.3} m espacés ≤{:.3} m, canaux {:.3} m, jardin rectangulaire et passage remblayé1.6 m ; construction stylized, {} corps conservés.",s.height_m,s.water_depth_m,s.pile_depth_m,s.pile_spacing_m,s.canal_width_m,out.bodies.len()));
    Ok(())
}

fn boundary_anchor(center: Point, target: Point, b: [f64; 4]) -> Point {
    let dx = target.x - center.x;
    let dy = target.y - center.y;
    let tx = if dx > 0.0 {
        (b[2] - center.x) / dx
    } else if dx < 0.0 {
        (b[0] - center.x) / dx
    } else {
        f64::INFINITY
    };
    let ty = if dy > 0.0 {
        (b[3] - center.y) / dy
    } else if dy < 0.0 {
        (b[1] - center.y) / dy
    } else {
        f64::INFINITY
    };
    let t = tx.min(ty);
    point(center.x + dx * t, center.y + dy * t)
}

fn shared_raised_platform(p: &Parameters, out: &mut LayoutPlan) -> Result<(), String> {
    if !p.details.iter().any(|t| t == "shared_raised_platform") {
        return Ok(());
    }
    let Some(first) = out.bodies.first() else {
        return Err("Plateforme commune sans corps résidentiel.".into());
    };
    let z = first.z;
    if z <= 0.0 || out.bodies.iter().any(|b| (b.z - z).abs() > 0.001) {
        return Err(
            "Plateforme commune : les corps doivent partager une cote surélevée explicite.".into(),
        );
    }
    let occupied = unite(
        &out.bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let b = bounds(&occupied);
    let surface = difference(&rectangle(b[0], b[1], b[2] - b[0], b[3] - b[1]), &occupied);
    if surface.len() != 1 || area(&surface) < 1.0 {
        return Err("Plateforme commune : le domaine ouvert entre corps n'est pas connexe.".into());
    }
    let material = p.support.material.as_deref().unwrap_or(&p.materials.frame);
    let cols = libm::ceil((b[2] - b[0]) / 3.0).max(1.0) as usize;
    let rows = libm::ceil((b[3] - b[1]) / 3.0).max(1.0) as usize;
    for row in 0..rows {
        for col in 0..cols {
            let q = point(
                b[0] + (col as f64 + 0.5) * (b[2] - b[0]) / cols as f64,
                b[1] + (row as f64 + 0.5) * (b[3] - b[1]) / rows as f64,
            );
            let post = rectangle(q.x - 0.1, q.y - 0.1, 0.2, 0.2);
            if area(&difference(&post, &surface)) <= 0.000_01 {
                out.features.push(feature(
                    &format!("shared-platform-post-{col}-{row}"),
                    FeatureKind::Post,
                    post,
                    0.0,
                    z,
                    material,
                ));
            }
        }
    }
    out.features.push(feature(
        "shared-raised-platform",
        FeatureKind::Deck,
        surface,
        z,
        0.18,
        &p.materials.frame,
    ));
    out.diagnostics.push(format!("Plateforme commune stylisée à {z:.3} m entre {} corps, plancher bois de 0,18 m et poteaux espacés au plus de 3 m ; aucun corps ajouté.", out.bodies.len()));
    Ok(())
}

fn street_jetty(out: &mut LayoutPlan) {
    let original: Vec<_> = out.bodies.iter().map(|b| b.footprint.clone()).collect();
    for (index, body) in out.bodies.iter_mut().enumerate() {
        if body.levels.len() < 2 || !body.parameters.details.iter().any(|t| t == "jetty") {
            continue;
        }
        let b = bounds(&body.footprint);
        let south = b[3];
        let mut frontage = vec![];
        let mut joining_frontage = vec![];
        for polygon in &body.footprint {
            for (a, q) in polygon
                .outer
                .iter()
                .zip(polygon.outer.iter().cycle().skip(1))
                .take(polygon.outer.len())
            {
                if (a.y - south).abs() < 0.001 && (q.y - south).abs() < 0.001 {
                    frontage = union(
                        &frontage,
                        &rectangle(a.x.min(q.x), south, (q.x - a.x).abs(), 0.35),
                    );
                    // The native beam already bears 0.10 m inside the body.
                    // Overlap that bearing before booleans so a quantised shared
                    // edge cannot turn the jetty into a disconnected room.
                    joining_frontage = union(
                        &joining_frontage,
                        &rectangle(a.x.min(q.x), south - 0.1, (q.x - a.x).abs(), 0.45),
                    );
                }
            }
        }
        let other = unite(
            &original
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != index)
                .map(|(_, s)| s.clone())
                .collect::<Vec<_>>(),
        );
        let blockers = union(
            &other,
            &unite(
                &out.context
                    .iter()
                    .chain(&out.features)
                    .filter(|f| matches!(f.kind, FeatureKind::Neighbor | FeatureKind::PartyWall))
                    .map(|f| f.surface.clone())
                    .collect::<Vec<_>>(),
            ),
        );
        let excluded = union(&blockers, &out.courts);
        let projection = difference(&frontage, &excluded);
        if projection.is_empty() {
            out.diagnostics.push(format!(
                "Corps {index} : encorbellement inapplicable, façade rue sans dégagement."
            ));
            continue;
        }
        let join = difference(&joining_frontage, &excluded);
        for (floor, level) in body.levels.iter_mut().enumerate().skip(1) {
            let historical = union(level, &projection);
            let joined = union(level, &join);
            // This certifies only the numerical shared-edge gap. An actual
            // upper-storey setback, court or opening must not be filled.
            if area(&difference(&join, &historical)) <= 1e-6
                && (area(&joined) - area(&historical)).abs() <= 1e-6
                && joined.len() <= level.len()
            {
                *level = joined;
            } else {
                out.diagnostics.push(format!(
                    "Corps {index}, niveau {floor} : raccord d'encorbellement non certifié, domaine historique conservé."
                ));
                *level = historical;
            }
        }
        body.arms = arms(std::slice::from_ref(body.levels.last().unwrap()));
        for (part, polygon) in projection.iter().enumerate() {
            let bounds = bounds(&vec![polygon.clone()]);
            let z = body.z + body.parameters.level_height_m;
            out.features.push(feature(
                &format!("jetty-beam-{index}-{part}"),
                FeatureKind::Beam,
                rectangle(bounds[0], south - 0.1, bounds[2] - bounds[0], 0.2),
                z - 0.2,
                0.2,
                &body.parameters.materials.frame,
            ));
            let consoles = libm::ceil((bounds[2] - bounds[0]) / 1.5).max(1.0) as usize;
            for i in 0..=consoles {
                let x = bounds[0] + (bounds[2] - bounds[0]) * i as f64 / consoles as f64;
                out.features.push(feature(
                    &format!("jetty-console-{index}-{part}-{i}"),
                    FeatureKind::Beam,
                    rectangle(x - 0.06, south - 0.12, 0.12, 0.47),
                    z - 0.25,
                    0.25,
                    &body.parameters.materials.frame,
                ));
            }
        }
    }
}

fn apply_components(
    p: &Parameters,
    role: Role,
    w: f64,
    d: f64,
    rng: &mut Rng,
    out: &mut LayoutPlan,
) -> Result<(), String> {
    if p.components.is_empty() || (p.components.len() == 1 && p.components[0].id == "main") {
        return Ok(());
    }
    let replaces = p
        .components
        .iter()
        .any(|c| c.role.residential() && c.placement != Placement::FacingMain);
    if replaces {
        out.bodies.clear();
    }
    // Resolve all quantities before positions: one shared orbital population.
    let mut resolved = vec![];
    for c in &p.components {
        if c.id == "upper_frame" {
            continue;
        }
        let n = rng.int(c.count[0], c.count[1]) as usize;
        let mut cp = p.clone();
        cp.components.clear();
        cp.footprint_family = c.footprint_family.clone();
        cp.roof_system = c.roof_system.clone();
        cp.roof_spec = c.roof_spec.clone();
        cp.materials = c.materials.clone();
        cp.structure_system = c.structure_system.clone();
        cp.envelope = c.envelope;
        cp.vertical_access = c.vertical_access;
        cp.vertical_routes = c.vertical_routes.clone();
        cp.support = c.support.clone();
        cp.level_materials = c.level_materials.clone();
        cp.wall_thickness_m = c.wall_thickness_m;
        cp.roof_pitch_deg = c.roof_pitch_deg;
        cp.overhang_m = c.overhang_m;
        cp.courtyard_ratio = c.courtyard_ratio;
        cp.floors = [rng.int(c.floors[0], c.floors[1]); 2];
        cp.level_height_m = c.level_height_m;
        cp.rooms_per_body = c.rooms_per_body;
        cp.bodies = [1, 1];
        cp.cells = [0, 0];
        let minimum = minimum_domain(&cp);
        let requested = [w * c.width_ratio[0], d * c.depth_ratio[0]];
        let mut cw = requested[0].max(minimum[0]);
        let mut cd = requested[1].max(minimum[1]);
        if matches!(c.footprint_family.as_str(), "FP-SQUARE" | "FP-TOWER") {
            // These primitives take one square side; keep the access minimum
            // on both axes rather than discarding the larger declared dimension.
            cw = cw.max(cd);
            cd = cw;
        }
        // Position from the same millimetre dimensions used by the primitive.
        // Otherwise a rounded prototype can steal a fraction of the 1.4 m gap.
        cw = snap(libm::ceil(cw * 1000.0) / 1000.0);
        cd = snap(libm::ceil(cd * 1000.0) / 1000.0);
        if [cw, cd] != requested {
            out.diagnostics.push(format!("Composant {} : {:.3} × {:.3} → {:.3} × {:.3} m pour murs et accès déclarés, {n} instances conservées.",c.id,requested[0],requested[1],cw,cd));
        }
        resolved.push((c, n, cw, cd, cp));
    }
    resolved.sort_by_key(|(c, ..)| c.placement == Placement::Peripheral);
    let main_max = resolved
        .iter()
        .filter(|(c, ..)| c.placement == Placement::Main)
        .map(|(_, _, cw, cd, _)| [*cw, *cd])
        .fold([0.0_f64; 2], |a, b| [a[0].max(b[0]), a[1].max(b[1])]);
    let main_n = resolved
        .iter()
        .filter(|(c, ..)| c.placement == Placement::Main)
        .map(|(_, n, ..)| *n)
        .sum::<usize>();
    let main_cols = libm::ceil(libm::sqrt(main_n.max(1) as f64)) as usize;
    let main_gap = if p
        .structural_spec
        .as_ref()
        .and_then(|s| s.retaining.as_ref())
        .is_some()
    {
        out.diagnostics.push("Gradins : dégagement déclaré de 3 m entre rangées/corps pour les vraies volées extérieures .9×2.6 m, construction stylized.".into());
        3.0
    } else {
        1.4
    };
    let peripheral_n = resolved
        .iter()
        .filter(|(c, ..)| c.placement == Placement::Peripheral)
        .map(|(_, n, ..)| *n)
        .sum::<usize>();
    let diameter = resolved
        .iter()
        .filter(|(c, ..)| c.placement == Placement::Peripheral)
        .map(|(_, _, cw, cd, _)| libm::hypot(*cw, *cd))
        .fold(0.0, f64::max);
    let mut orbit = 0.0;
    let mut main_index = 0;
    let mut peripheral_index = 0;
    for (c, n, cw, cd, cp) in resolved {
        if c.placement == Placement::Peripheral && orbit == 0.0 {
            let origin = point(w * 0.5, d * 0.5);
            let core_radius = out
                .bodies
                .iter()
                .flat_map(|b| &b.footprint)
                .flat_map(|p| &p.outer)
                .map(|q| libm::hypot(q.x - origin.x, q.y - origin.y))
                .fold(w.max(d) * 0.5, f64::max);
            let separation = if peripheral_n > 1 {
                (diameter + 1.4) / (2.0 * libm::sin(PI / peripheral_n as f64))
            } else {
                0.0
            };
            orbit = (core_radius + diameter * 0.5 + 1.4).max(separation);
            out.diagnostics.push(format!("Orbites composants : {peripheral_n} instances pré-résolues sur rayon commun {orbit:.3} m, dégagement ≥1,4 m."));
        }
        let rear_y = out
            .bodies
            .iter()
            .map(|b| bounds(&b.footprint)[1])
            .fold(0.0, f64::min)
            - cd
            - 1.4;
        let span_x = n as f64 * cw + n.saturating_sub(1) as f64 * 1.4;
        let span_y = n as f64 * cd + n.saturating_sub(1) as f64 * 1.4;
        // Resolve a centred row once. Re-rounding half-grid anchors per
        // instance could shorten one nominal 1.4 m interval by a millimetre.
        let row_x = snap((w - span_x) * 0.5);
        let row_y = snap((d - span_y) * 0.5);
        let adjacent_x = out
            .bodies
            .iter()
            .map(|b| bounds(&b.footprint)[2])
            .reduce(f64::max)
            .unwrap_or(w);
        let adjacent_x =
            libm::ceil((adjacent_x + 1.4) / crate::geometry::GRID_M) * crate::geometry::GRID_M;
        if matches!(c.placement, Placement::Rear | Placement::Adjacent) {
            out.diagnostics.push(format!("Composant {} : origine de rangée commune à la grille et placement adjacent depuis l'emprise réelle déjà construite ; intervalle1,4m déclaré, {n} instances conservées.",c.id));
        }
        for i in 0..n {
            let (x, y) = match c.placement {
                Placement::North => (row_x + i as f64 * (cw + 1.4), -cd - 1.4),
                Placement::South | Placement::AlongFront => {
                    (row_x + i as f64 * (cw + 1.4), d + 1.4)
                }
                Placement::East => (w + 1.4, row_y + i as f64 * (cd + 1.4)),
                Placement::West => (-cw - 1.4, row_y + i as f64 * (cd + 1.4)),
                Placement::Central | Placement::Courtyard => {
                    let cols = libm::ceil(libm::sqrt(n as f64)) as usize;
                    (
                        (w - cols as f64 * cw - cols.saturating_sub(1) as f64 * 1.4) * 0.5
                            + (i % cols) as f64 * (cw + 1.4),
                        (d - n.div_ceil(cols) as f64 * cd
                            - n.div_ceil(cols).saturating_sub(1) as f64 * 1.4)
                            * 0.5
                            + (i / cols) as f64 * (cd + 1.4),
                    )
                }
                Placement::Adjacent => (adjacent_x, i as f64 * (cd + 1.4)),
                Placement::Rear => (row_x + i as f64 * (cw + 1.4), rear_y),
                Placement::FacingMain => (row_x + i as f64 * (cw + 1.4), d + 1.4),
                Placement::Main => {
                    let q = (
                        (main_index % main_cols) as f64 * (main_max[0] + main_gap),
                        (main_index / main_cols) as f64 * (main_max[1] + main_gap),
                    );
                    main_index += 1;
                    q
                }
                Placement::Peripheral => {
                    let a = TAU * (peripheral_index as f64 + 0.5) / peripheral_n as f64;
                    peripheral_index += 1;
                    (
                        w * 0.5 + orbit * libm::cos(a) - cw * 0.5,
                        d * 0.5 + orbit * libm::sin(a) - cd * 0.5,
                    )
                }
            };
            let shape = primitive(
                &c.footprint_family,
                cw,
                cd,
                &format!("component:{}:{i}", c.id),
            )?;
            let anchor = point(x, y);
            let surface = translate(&shape.footprint, anchor.x, anchor.y);
            let buffer = offset(&surface, 0.7);
            if let Some((index, body, overlap)) =
                out.bodies.iter().enumerate().find_map(|(index, b)| {
                    let overlap = area(&intersection(&offset(&b.footprint, 0.7), &buffer));
                    (overlap > 0.001).then_some((index, b, overlap))
                })
            {
                return Err(format!(
                    "Composant {} instance {i} sans dégagement de 1,4 m avec corps{index} ({}) : intersection des marges {overlap:.6} m² ; aucune instance supprimée.",
                    c.id,
                    body.component.as_deref().unwrap_or("principal")
                ));
            }
            if out
                .features
                .iter()
                .filter(|f| {
                    matches!(
                        f.kind,
                        FeatureKind::Enclosure
                            | FeatureKind::Fence
                            | FeatureKind::DecorativeWall
                            | FeatureKind::Retaining
                    )
                })
                .any(|f| area(&intersection(&buffer, &f.surface)) > 0.001)
            {
                return Err(format!(
                    "Composant {} instance {i} croise un obstacle architectural.",
                    c.id
                ));
            }
            let mut body = spec(surface, &cp, c.role);
            body.component = Some(c.id.clone());
            if c.id == "stone_base" {
                body.role = role;
            }
            out.bodies.push(body);
        }
    }
    Ok(())
}

fn spatial(
    recipe: &Recipe,
    p: &Parameters,
    w: f64,
    d: f64,
    out: &mut LayoutPlan,
) -> Result<(), String> {
    use FeatureKind::*;
    let kind = recipe
        .component_kind
        .as_deref()
        .ok_or("Composant découvert sans type.")?;
    let full = if p.footprint_family == "FP-ELLIPTICAL-RING" {
        ellipse(
            w * 0.5,
            d * 0.5,
            w * 0.5,
            d * 0.5,
            p.roof_spec.round_segments as usize,
        )
    } else {
        rectangle(0.0, 0.0, w, d)
    };
    let (feature_kind, surface, height) = match kind {
        "livestock_enclosure" => (LivestockPen, difference(&full, &offset(&full, -0.25)), 1.6),
        "palisade" => (Fence, difference(&full, &offset(&full, -0.25)), 2.4),
        "open_court" => (RitualCourt, full.clone(), 0.1),
        "prestige_wall" | "puuc_facade" => (DecorativeWall, rectangle(0.0, 0.0, w, 0.7), 3.0),
        "earth_platform" => (Platform, full.clone(), 1.4),
        "windbreak" => (DecorativePanel, rectangle(0.0, 0.0, w, 0.25), 2.0),
        "drying_rack" => (DryingRack, full.clone(), 2.0),
        _ => return Err(format!("Composant spatial inconnu : {kind}.")),
    };
    let gate = rectangle(w * 0.5 - 0.75, d - 1.0, 1.5, 2.0);
    out.features.push(feature(
        "spatial-component",
        feature_kind,
        difference(&surface, &gate),
        0.0,
        height,
        &p.materials.frame,
    ));
    out.courts = if matches!(feature_kind, LivestockPen | Fence) {
        offset(&full, -0.25)
    } else {
        vec![]
    };
    if matches!(feature_kind, DryingRack | Platform) {
        for (i, (x, y)) in [
            (0.2, 0.2),
            (w - 0.4, 0.2),
            (w - 0.4, d - 0.4),
            (0.2, d - 0.4),
        ]
        .into_iter()
        .enumerate()
        {
            out.features.push(feature(
                &format!("spatial-support-{i}"),
                Post,
                rectangle(x, y, 0.25, 0.25),
                0.0,
                height,
                &p.materials.frame,
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod jetty_tests {
    use super::*;

    fn plan() -> LayoutPlan {
        let data = crate::catalogue::catalogue().unwrap();
        let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B03").unwrap();
        let mut plan = build_layout(recipe, &recipe.parameters, "jetty-obstacles").unwrap();
        plan.bodies.truncate(1);
        let footprint = plan.bodies[0].footprint.clone();
        for level in &mut plan.bodies[0].levels {
            *level = footprint.clone();
        }
        plan.context.clear();
        plan.features.clear();
        plan.courts.clear();
        plan
    }

    #[test]
    fn blocked_frontage_keeps_the_inapplicable_diagnostic() {
        let mut plan = plan();
        let b = bounds(&plan.bodies[0].footprint);
        plan.context.push(feature(
            "street-neighbor",
            FeatureKind::Neighbor,
            rectangle(b[0] - 1.0, b[3] - 0.001, b[2] - b[0] + 2.0, 1.0),
            0.0,
            10.0,
            "MAT-STONE",
        ));
        let before = plan.bodies[0].levels.clone();
        street_jetty(&mut plan);
        assert_eq!(plan.bodies[0].levels, before);
        assert!(plan.features.is_empty());
        assert!(plan.diagnostics.last().unwrap().contains("inapplicable"));
    }

    #[test]
    fn the_bearing_join_preserves_a_court_and_the_two_external_parts() {
        let mut plan = plan();
        let b = bounds(&plan.bodies[0].footprint);
        let width = (b[2] - b[0]) / 3.0;
        plan.courts = rectangle(b[0] + width, b[3] - 0.5, width, 1.0);
        plan.bodies[0].footprint = difference(&plan.bodies[0].footprint, &plan.courts);
        let footprint = plan.bodies[0].footprint.clone();
        for level in &mut plan.bodies[0].levels {
            *level = footprint.clone();
        }
        street_jetty(&mut plan);
        for level in plan.bodies[0].levels.iter().skip(1) {
            assert_eq!(level.len(), 1);
            assert!(area(&intersection(level, &plan.courts)) <= 1e-6);
            assert!((bounds(level)[3] - b[3] - 0.35).abs() < 0.001);
        }
        assert_eq!(
            plan.features
                .iter()
                .filter(|f| f.id.starts_with("jetty-beam-"))
                .count(),
            2
        );
    }
}

#[cfg(test)]
mod cell_hatch_tests {
    use super::*;

    fn parameters() -> Parameters {
        crate::catalogue::catalogue()
            .unwrap()
            .recipes
            .iter()
            .find(|recipe| recipe.id == "AS-HIM-B02")
            .unwrap()
            .parameters
            .clone()
    }

    #[test]
    fn the_captured_external_cell_has_no_room_for_its_private_shaft() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/houses/private-cell-grid.json"
        ))
        .unwrap();
        let common: Surface = serde_json::from_value(fixture["common"].clone()).unwrap();
        let hatch = (
            fixture["width_m"].as_f64().unwrap(),
            fixture["run_m"].as_f64().unwrap(),
        );
        assert!(!hatch_grid_certified(
            fixture["raw_cell_m"][0].as_f64().unwrap(),
            fixture["raw_cell_m"][1].as_f64().unwrap(),
            fixture["wall_m"].as_f64().unwrap(),
            hatch,
        ));
        assert!(area(&common) - hatch.0 * hatch.1 < 0.45);
    }

    #[test]
    fn the_certificate_accepts_long_cells_and_rejects_insufficient_remaining_area() {
        assert!(hatch_grid_certified(2.34, 3.04, 0.67, (0.9, 1.3)));
        assert!(!hatch_grid_certified(2.34, 2.84, 0.67, (0.9, 1.3)));
    }

    #[test]
    fn certified_historical_grids_keep_all_cells_court_and_gate_bytes() {
        let mut p = parameters();
        p.wall_thickness_m = [0.45; 2];
        let before = whole_cells(&p, 18.866, 14.534, 12, "cell-history", None).unwrap();
        let after = whole_cells(&p, 18.866, 14.534, 12, "cell-history", Some((0.9, 1.3))).unwrap();
        assert_eq!(
            serde_json::to_vec(&before).unwrap(),
            serde_json::to_vec(&after).unwrap()
        );
        p.roof_system = "RF-GABLE".into();
        p.floors = [1; 2];
        assert_eq!(private_cell_hatch(&p), None);
    }

    #[test]
    fn thick_external_walls_get_complete_cells_with_real_hatch_space() {
        let mut p = parameters();
        p.wall_thickness_m = [0.8; 2];
        let (_, _, _, _, cells) =
            whole_cells(&p, 14.0, 12.0, 12, "thick-cell", Some((0.9, 1.3))).unwrap();
        assert_eq!(cells.len(), 12);
        for cell in cells {
            let floor = offset(&cell, -0.8);
            let b = bounds(&floor);
            let (width, run) = if b[2] - b[0] < b[3] - b[1] {
                (0.9, 1.3)
            } else {
                (1.3, 0.9)
            };
            let shaft = rectangle(b[0] + 0.031, b[1] + 0.031, width, run);
            assert!(area(&difference(&offset(&shaft, 0.03), &floor)) < 1e-6);
            let remaining = difference(&floor, &shaft);
            assert_eq!(remaining.len(), 1);
            assert!(area(&remaining) >= 0.45);
        }
    }
}
