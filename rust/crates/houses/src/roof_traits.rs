//! Geometric witnesses for source traits, evaluated on the exported mesh.
use super::*;
use num_rational::BigRational as Q;
use num_traits::Zero;

#[derive(Clone, Copy, Debug)]
pub enum RoofTrait {
    Inward,
    Interlocking,
}

fn center(mesh: &RoofMesh, face: &RoofFace) -> Point {
    let n = face.vertices.len() as f64;
    Point {
        x: face
            .vertices
            .iter()
            .map(|&i| mesh.vertices[i as usize].x)
            .sum::<f64>()
            / n,
        y: face
            .vertices
            .iter()
            .map(|&i| mesh.vertices[i as usize].y)
            .sum::<f64>()
            / n,
    }
}

fn valley(mesh: &RoofMesh, edge: &RoofEdge) -> bool {
    let (Some(first), Some(second)) = (edge.faces[0], edge.faces[1]) else {
        return false;
    };
    let a = &mesh.faces[first as usize];
    let b = &mesh.faces[second as usize];
    if a.normal[2] <= EPS || b.normal[2] <= EPS {
        return false;
    }
    let p = &mesh.vertices[edge.vertices[0] as usize];
    let q = &mesh.vertices[edge.vertices[1] as usize];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    let den = dx * dx + dy * dy;
    if den <= EPS * EPS {
        return false;
    }
    let mid = Point {
        x: (p.x + q.x) * 0.5,
        y: (p.y + q.y) * 0.5,
    };
    let side = |f: &RoofFace| {
        let c = center(mesh, f);
        let transverse = (-dy * (c.x - mid.x) + dx * (c.y - mid.y)) / den;
        (f.normal[0] * dy - f.normal[1] * dx) * transverse / f.normal[2]
    };
    side(a) > 0.0001 && side(b) > 0.0001
}

fn exact_center(mesh: &RoofMesh, face: &RoofFace) -> Option<[Q; 2]> {
    if face.vertices.len() < 3 {
        return None;
    }
    let mut total = [Q::zero(), Q::zero()];
    for &index in &face.vertices {
        let vertex = mesh.vertices.get(index as usize)?;
        total[0] += Q::from_float(vertex.x)?;
        total[1] += Q::from_float(vertex.y)?;
        Q::from_float(vertex.z)?;
    }
    let count = Q::from_integer(face.vertices.len().into());
    Some(total.map(|v| v / &count))
}

fn drains_inward(mesh: &RoofMesh, face: &RoofFace, bounds: [f64; 4]) -> bool {
    let Some([cx, cy]) = exact_center(mesh, face) else {
        return false;
    };
    let [Some(nx), Some(ny), Some(_)] = face.normal.map(Q::from_float) else {
        return false;
    };
    let [Some(x0), Some(y0), Some(x1), Some(y1)] = bounds.map(Q::from_float) else {
        return false;
    };
    // The same half-grid uncertainty already bounds the open-court area test.
    let delta = Q::from_float(g::GRID_M * 0.5).expect("finite grid constant");
    let (x0, y0, x1, y1) = (x0 + &delta, y0 + &delta, x1 - &delta, y1 - &delta);
    if x1 <= x0 || y1 <= y0 {
        return false;
    }
    let dx = cx.clone().max(x0).min(x1) - cx;
    let dy = cy.clone().max(y0).min(y1) - cy;
    let dot = &nx * &dx + &ny * &dy;
    if dot <= Q::zero() {
        return false;
    }
    let cosine = Q::from_float(1e-6).expect("finite cosine constant");
    &dot * &dot >= &cosine * &cosine * (&nx * &nx + &ny * &ny) * (&dx * &dx + &dy * &dy)
}

fn valley_exact(mesh: &RoofMesh, edge: &RoofEdge) -> bool {
    let (Some(first), Some(second)) = (edge.faces[0], edge.faces[1]) else {
        return false;
    };
    let (Some(a), Some(b)) = (
        mesh.faces.get(first as usize),
        mesh.faces.get(second as usize),
    ) else {
        return false;
    };
    if a.normal[2] <= EPS || b.normal[2] <= EPS {
        return false;
    }
    let (Some(p), Some(q)) = (
        mesh.vertices.get(edge.vertices[0] as usize),
        mesh.vertices.get(edge.vertices[1] as usize),
    ) else {
        return false;
    };
    let [Some(px), Some(py), Some(_), Some(qx), Some(qy), Some(_)] =
        [p.x, p.y, p.z, q.x, q.y, q.z].map(Q::from_float)
    else {
        return false;
    };
    let dx = &qx - &px;
    let dy = &qy - &py;
    if dx.is_zero() && dy.is_zero() {
        return false;
    }
    let two = Q::from_integer(2.into());
    let midx = (px + qx) / &two;
    let midy = (py + qy) / &two;
    let side = |face: &RoofFace| -> Option<Q> {
        let [cx, cy] = exact_center(mesh, face)?;
        let [Some(nx), Some(ny), Some(_)] = face.normal.map(Q::from_float) else {
            return None;
        };
        Some((&nx * &dy - &ny * &dx) * (-&dy * (cx - &midx) + &dx * (cy - &midy)))
    };
    match (side(a), side(b)) {
        (Some(a), Some(b)) => a > Q::zero() && b > Q::zero(),
        _ => false,
    }
}

fn projection(mesh: &RoofMesh, faces: &[&RoofFace]) -> Surface {
    let polygons: Vec<_> = faces
        .iter()
        .flat_map(|face| {
            g::to_geo(&vec![Polygon {
                outer: face
                    .vertices
                    .iter()
                    .map(|&i| {
                        let v = &mesh.vertices[i as usize];
                        Point { x: v.x, y: v.y }
                    })
                    .collect(),
                holes: vec![],
            }])
            .0
        })
        .collect();
    g::from_geo(&geo::algorithm::bool_ops::unary_union(&polygons))
}

fn inside(p: Point, surface: &Surface) -> bool {
    use geo::Intersects;
    g::to_geo(surface).intersects(&geo::Point::new(p.x, p.y))
}

pub fn inspect_roof_trait(unit: &HouseUnit, requested: RoofTrait) -> Result<String, String> {
    let mesh = &unit.roofs;
    match requested {
        RoofTrait::Inward => {
            let owners: BTreeMap<_, _> = unit
                .bodies
                .iter()
                .filter(|b| b.roof_spec.drainage == Some(RoofDrainage::Inward))
                .filter_map(|b| b.levels.last().map(|l| (b.id.as_str(), l.index)))
                .collect();
            let faces: Vec<_> = mesh
                .faces
                .iter()
                .filter(|f| {
                    owners.get(f.body_id.as_str()) == Some(&f.level)
                        && f.feature_id.is_none()
                        && f.kind == RoofFaceKind::Pan
                })
                .collect();
            if faces.is_empty() {
                return Err("Trait inward_roof sans pans physiques exportés.".into());
            }
            let mut best_corners = 0;
            let mut invalid = faces.len();
            let mut blocked = 0.0;
            for court in &unit.partition.courtyards {
                let court_surface = vec![court.clone()];
                let [x0, y0, x1, y1] = bounds(&court_surface);
                if court.outer.len() != 4 {
                    continue;
                }
                if [(x0, y0), (x0, y1), (x1, y0), (x1, y1)]
                    .iter()
                    .any(|&(x, y)| !court.outer.iter().any(|p| p.x == x && p.y == y))
                {
                    continue;
                }
                invalid = faces
                    .iter()
                    .filter(|f| !drains_inward(mesh, f, [x0, y0, x1, y1]))
                    .count();
                if invalid > 0 {
                    continue;
                }
                blocked = area(&intersection(&projection(mesh, &faces), &court_surface));
                if blocked > g::area_tolerance(&court_surface) {
                    continue;
                }
                let mut corners = BTreeSet::new();
                for edge in &mesh.edges {
                    if !valley_exact(mesh, edge) {
                        continue;
                    }
                    let first = &mesh.faces[edge.faces[0].unwrap() as usize];
                    let second = &mesh.faces[edge.faces[1].unwrap() as usize];
                    if owners.get(first.body_id.as_str()) != Some(&first.level)
                        || owners.get(second.body_id.as_str()) != Some(&second.level)
                    {
                        continue;
                    }
                    for &id in &edge.vertices {
                        let v = &mesh.vertices[id as usize];
                        for (i, p) in court.outer.iter().enumerate() {
                            if libm::hypot(v.x - p.x, v.y - p.y) <= 0.002 {
                                corners.insert(i);
                            }
                        }
                    }
                }
                best_corners = best_corners.max(corners.len());
                if corners.len() == 4 {
                    return Ok(format!(
                        "Pans rentrants physiques : {} pans dirigés vers la cour ouverte, quatre noues d'angle à cotes communes.",
                        faces.len()
                    ));
                }
            }
            Err(format!(
                "Trait inward_roof sans cour ouverte et quatre noues d'angle réelles (pans {}, pentes invalides {invalid}, cour couverte {blocked:.9} m², angles {best_corners}/4).",
                faces.len()
            ))
        }
        RoofTrait::Interlocking => {
            let mut pavilions = vec![];
            for feature in unit
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::RoofPavilion && !f.surface.is_empty())
            {
                let ridge = mesh.edges.iter().any(|edge| {
                    let (Some(first), Some(second)) = (edge.faces[0], edge.faces[1]) else {
                        return false;
                    };
                    let a = &mesh.faces[first as usize];
                    let b = &mesh.faces[second as usize];
                    if a.normal[2] <= EPS
                        || b.normal[2] <= EPS
                        || a.normal
                            .iter()
                            .zip(b.normal)
                            .map(|(x, y)| x * y)
                            .sum::<f64>()
                            > 1.0 - 1e-6
                    {
                        return false;
                    }
                    if !matches!(edge.kind, RoofEdgeKind::Ridge | RoofEdgeKind::Hip) {
                        return false;
                    }
                    let p = &mesh.vertices[edge.vertices[0] as usize];
                    let q = &mesh.vertices[edge.vertices[1] as usize];
                    p.z.max(q.z) > feature.z_m + feature.height_m + 0.01
                        && inside(
                            Point {
                                x: (p.x + q.x) * 0.5,
                                y: (p.y + q.y) * 0.5,
                            },
                            &feature.surface,
                        )
                });
                if ridge
                    && pavilions.iter().all(|prior: &&Feature| {
                        area(&difference(&feature.surface, &prior.surface))
                            + area(&difference(&prior.surface, &feature.surface))
                            > 1e-5
                    })
                {
                    pavilions.push(feature);
                }
            }
            let mut length = 0.0;
            let mut count = 0;
            for edge in &mesh.edges {
                if !valley(mesh, edge) {
                    continue;
                }
                let p = &mesh.vertices[edge.vertices[0] as usize];
                let q = &mesh.vertices[edge.vertices[1] as usize];
                let mid = Point {
                    x: (p.x + q.x) * 0.5,
                    y: (p.y + q.y) * 0.5,
                };
                if pavilions.iter().any(|f| inside(mid, &f.surface)) {
                    length += libm::hypot(q.x - p.x, q.y - p.y);
                    count += 1;
                }
            }
            if pavilions.len() >= 2 && length > 0.1 {
                Ok(format!(
                    "Toitures imbriquées physiques : {} pavillons à faîtages distincts, {count} segments de noue partagée ({length:.3} m).",
                    pavilions.len()
                ))
            } else {
                Err("Trait interlocking_roofs sans deux pavillons à faîtages exportés distincts et noue commune positive.".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> HouseUnit {
        serde_json::from_str(include_str!(
            "../../../fixtures/houses/inward-needle-unit0.json"
        ))
        .unwrap()
    }

    fn analytic(vertices: &[[f64; 3]], normal: [f64; 3]) -> RoofMesh {
        let mut face = fixture().roofs.faces[0].clone();
        face.vertices = vec![0, 1, 2];
        face.normal = normal;
        RoofMesh {
            vertices: vertices
                .iter()
                .map(|&[x, y, z]| Vertex3 { x, y, z })
                .collect(),
            faces: vec![face],
            ..Default::default()
        }
    }

    fn valley_fixture() -> (RoofMesh, RoofEdge) {
        let mut mesh = analytic(
            &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 1.0]],
            [0.0, -1.0, 1.0],
        );
        mesh.vertices.push(Vertex3 {
            x: 0.0,
            y: -1.0,
            z: 1.0,
        });
        let mut second = mesh.faces[0].clone();
        second.vertices = vec![1, 0, 3];
        second.normal = [0.0, 1.0, 1.0];
        mesh.faces.push(second);
        let mut edge = fixture().roofs.edges[0].clone();
        edge.vertices = [0, 1];
        edge.faces = [Some(0), Some(1)];
        (mesh, edge)
    }

    #[test]
    fn exported_needles_and_shifted_court_rims_keep_the_real_four_valleys() {
        let unit = fixture();
        let before = serde_json::to_vec(&unit).unwrap();
        assert!(
            inspect_roof_trait(&unit, RoofTrait::Inward)
                .unwrap()
                .contains("32 pans")
        );
        assert_eq!(serde_json::to_vec(&unit).unwrap(), before);
        for shift in [-1e-7, 0.0, 1e-7] {
            let mut adjusted = unit.clone();
            for p in &mut adjusted.partition.courtyards[0].outer {
                p.x = (p.x * 1e6).round() / 1e6 + shift;
                p.y = (p.y * 1e6).round() / 1e6 - shift;
            }
            assert!(inspect_roof_trait(&adjusted, RoofTrait::Inward).is_ok());
        }
    }

    #[test]
    fn every_pan_including_a_tiny_corner_must_really_drain_inward() {
        let original = fixture();
        let large = original
            .roofs
            .faces
            .iter()
            .position(|face| {
                face.kind == RoofFaceKind::Pan
                    && face.level == 1
                    && area(&projection(&original.roofs, &[face])) > 1.0
            })
            .unwrap();
        for index in [52, large] {
            let mut unit = fixture();
            assert_eq!(unit.roofs.faces[index].kind, RoofFaceKind::Pan);
            unit.roofs.faces[index].normal[0] *= -1.0;
            unit.roofs.faces[index].normal[1] *= -1.0;
            assert!(inspect_roof_trait(&unit, RoofTrait::Inward).is_err());
        }
        let mut mesh = analytic(
            &[[0.2, -0.1, 1.0], [0.8, -0.1, 1.0], [0.8, 0.0, 0.0]],
            [1.0, 0.0, 1.0],
        );
        assert!(!drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
        mesh.faces[0].normal[1] = 1e-17;
        assert!(!drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
        mesh.faces[0].normal[1] = f64::NAN;
        assert!(!drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
        mesh.faces[0].vertices[0] = u32::MAX;
        assert!(!drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
    }

    #[test]
    fn drainage_is_independent_of_positive_face_width() {
        for width in [1e-3, 1e-6, 1e-9, 1e-12] {
            let mesh = analytic(
                &[[0.2, -width, 1.0], [0.8, -width, 1.0], [0.8, 0.0, 0.0]],
                [0.0, 1.0, 1.0],
            );
            assert!(drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
        }
        for (width, expected) in [(1e-9, true), (0.002, false)] {
            let mesh = analytic(
                &[[-width, 0.0, 1.0], [-width, width, 1.0], [0.0, width, 0.0]],
                [0.0, 1.0, 1.0],
            );
            assert_eq!(
                drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]),
                expected
            );
        }
        let mesh = analytic(
            &[[0.2, 0.2, 1.0], [0.8, 0.2, 1.0], [0.8, 0.8, 0.0]],
            [0.0, 1.0, 1.0],
        );
        assert!(!drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
        assert!(!drains_inward(
            &mesh,
            &mesh.faces[0],
            [0.0, 0.0, 0.0001, 1.0]
        ));
    }

    #[test]
    fn exact_valleys_reject_ridges_coplanarity_and_invalid_incidence() {
        let (mesh, edge) = valley_fixture();
        assert!(valley_exact(&mesh, &edge));
        for kind in 0..7 {
            let mut invalid = mesh.clone();
            let mut e = edge.clone();
            match kind {
                0 => {
                    invalid.vertices[2].z = -1.0;
                    invalid.vertices[3].z = -1.0;
                    invalid.faces[0].normal[1] = 1.0;
                    invalid.faces[1].normal[1] = -1.0;
                }
                1 => invalid.faces[1].normal = invalid.faces[0].normal,
                2 => invalid.faces[0].normal[2] = 0.0,
                3 => e.vertices = [0, 0],
                4 => invalid.vertices[0].x = f64::NAN,
                5 => invalid.faces[0].normal[2] = f64::INFINITY,
                _ => e.faces[1] = None,
            }
            assert!(!valley_exact(&invalid, &e), "negative {kind}");
        }
    }

    #[test]
    fn a_missing_whole_corner_and_a_covered_court_are_rejected() {
        let mut unit = fixture();
        let corner = unit.partition.courtyards[0].outer[0];
        unit.roofs.edges.retain(|edge| {
            !edge.vertices.iter().any(|&i| {
                let p = &unit.roofs.vertices[i as usize];
                libm::hypot(p.x - corner.x, p.y - corner.y) <= 0.002
            })
        });
        let error = inspect_roof_trait(&unit, RoofTrait::Inward).unwrap_err();
        assert!(error.contains("angles 3/4"), "{error}");
        let mut unit = fixture();
        let [x0, _, x1, y1] = bounds(&unit.partition.courtyards);
        let first = unit.roofs.vertices.len() as u32;
        let mut cover = unit.roofs.faces[52].clone();
        unit.roofs.vertices.extend(
            [
                point(-100.0, -100.0),
                point(x1 + 1.0, y1 + 1.0),
                point(x0 - 1.0, y1 + 1.0),
            ]
            .iter()
            .map(|p| Vertex3 {
                x: p.x,
                y: p.y,
                z: 100.0 - cover.normal[1] / cover.normal[2] * p.y,
            }),
        );
        cover.vertices = vec![first, first + 1, first + 2];
        unit.roofs.faces.push(cover);
        let error = inspect_roof_trait(&unit, RoofTrait::Inward).unwrap_err();
        assert!(error.contains("pentes invalides 0"), "{error}");
    }

    #[test]
    fn valley_sign_is_invariant_under_an_exact_translation() {
        let (mesh, edge) = valley_fixture();
        let mut translated = mesh.clone();
        for p in &mut translated.vertices {
            let (x, y) = (p.x, p.y);
            p.x += 1024.0;
            p.y -= 2048.0;
            assert_eq!(p.x - 1024.0, x);
            assert_eq!(p.y + 2048.0, y);
        }
        assert_eq!(valley_exact(&mesh, &edge), valley_exact(&translated, &edge));
        let mesh = analytic(
            &[[0.25, -0.125, 1.0], [0.75, -0.125, 1.0], [0.75, 0.0, 0.0]],
            [0.0, 1.0, 1.0],
        );
        let mut translated = mesh.clone();
        for p in &mut translated.vertices {
            let (x, y) = (p.x, p.y);
            p.x += 1024.0;
            p.y -= 2048.0;
            assert_eq!(p.x - 1024.0, x);
            assert_eq!(p.y + 2048.0, y);
        }
        assert!(drains_inward(&mesh, &mesh.faces[0], [0.0, 0.0, 1.0, 1.0]));
        assert!(drains_inward(
            &translated,
            &translated.faces[0],
            [1024.0, -2048.0, 1025.0, -2047.0]
        ));
    }
}
