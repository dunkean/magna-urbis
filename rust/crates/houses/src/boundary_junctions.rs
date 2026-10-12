//! Certified affine junctions of the shared Boundary arrangement.
use super::*;
#[path = "boundary_authority.rs"]
mod authority;
#[path = "boundary_supports.rs"]
mod supports;

pub(super) struct Relocated {
    pub cells: Surface,
    pub owners: Vec<usize>,
    pub moved: usize,
    pub displacement: f64,
    pub collapsed: usize,
    pub collapsed_area: f64,
}

fn agreed(planes: &[Plane], p: Point) -> bool {
    let z = planes[0].height(p);
    planes.iter().all(|plane| {
        let other = plane.height(p);
        (other - z).abs() <= 8.0 * ulp(z.abs().max(other.abs()))
    })
}

fn target(
    p: Point,
    planes: &[Plane],
    segments: &[(Point, Point)],
    budget: f64,
) -> Result<Point, String> {
    if planes.len() < 2 || agreed(planes, p) {
        return Ok(p);
    }
    let base = planes[0];
    let constraints: Vec<_> = planes[1..]
        .iter()
        .map(|plane| Plane {
            a: plane.a - base.a,
            b: plane.b - base.b,
            c: plane.c - base.c,
        })
        .filter(|line| line.a != 0.0 || line.b != 0.0)
        .collect();
    let Some(&first) = constraints.first() else {
        return Err("Jonction Boundary de plans parallèles incompatibles.".into());
    };
    let independent = constraints.iter().skip(1).find(|line| {
        let det = first.a * line.b - first.b * line.a;
        det.abs() > 64.0 * f64::EPSILON * (first.a * line.b).abs().max((first.b * line.a).abs())
    });
    let q = if let Some(second) = independent {
        let det = first.a * second.b - first.b * second.a;
        Point {
            x: (first.b * second.c - first.c * second.b) / det,
            y: (first.c * second.a - first.a * second.c) / det,
        }
    } else {
        let mut candidates: Vec<_> = segments
            .iter()
            .enumerate()
            .filter(|(_, (a, b))| distance_to_segment(p, *a, *b) <= budget)
            .collect();
        candidates.sort_by(|(i, (a, b)), (j, (c, d))| {
            distance_to_segment(p, *a, *b)
                .total_cmp(&distance_to_segment(p, *c, *d))
                .then(i.cmp(j))
        });
        let on_segment = candidates.into_iter().find_map(|(_, &(a, b))| {
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let denominator = first.a * dx + first.b * dy;
            if denominator.abs()
                <= 64.0 * f64::EPSILON * (first.a * dx).abs().max((first.b * dy).abs())
            {
                return None;
            }
            let t = -first.height(a) / denominator;
            if !(0.0..=1.0).contains(&t) {
                return None;
            }
            let q = Point {
                x: a.x + t * dx,
                y: a.y + t * dy,
            };
            (length(p, q) <= budget && agreed(planes, q)).then_some(q)
        });
        on_segment.unwrap_or_else(|| {
            let offset = first.height(p) / (first.a * first.a + first.b * first.b);
            Point {
                x: p.x - offset * first.a,
                y: p.y - offset * first.b,
            }
        })
    };
    if !q.x.is_finite() || !q.y.is_finite() || length(p, q) > budget || !agreed(planes, q) {
        return Err(format!(
            "Jonction Boundary affine hors certificat à {:.12},{:.12} (déplacement {:.12}m, borne {:.12}m).",
            p.x,
            p.y,
            length(p, q),
            budget
        ));
    }
    Ok(q)
}

/// A zero chain is established by directed subsegments, never an area cutoff.
#[cfg(test)]
fn null_chain(polygon: &Polygon) -> bool {
    let points: Vec<_> = std::iter::once(&polygon.outer)
        .chain(&polygon.holes)
        .flatten()
        .copied()
        .collect();
    let mut balance = BTreeMap::<(usize, usize), (usize, i32)>::new();
    for ring in std::iter::once(&polygon.outer).chain(&polygon.holes) {
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            if a == b {
                return false;
            }
            let mut cuts: Vec<_> = points
                .iter()
                .enumerate()
                .filter_map(|(i, &p)| {
                    let t = parameter(p, a, b);
                    (orient(a, b, p) == 0 && (0.0..=1.0).contains(&t)).then_some((t, i))
                })
                .collect();
            cuts.sort_by(|(t, i), (u, j)| t.total_cmp(u).then(i.cmp(j)));
            cuts.dedup_by(|(_, i), (_, j)| points[*i] == points[*j]);
            for pair in cuts.windows(2) {
                let (i, j) = (pair[0].1, pair[1].1);
                let entry = balance.entry((i.min(j), i.max(j))).or_default();
                entry.0 += 1;
                entry.1 += if i < j { 1 } else { -1 };
            }
        }
    }
    !balance.is_empty() && balance.values().all(|&edge| edge == (2, 0))
}

/// Cancel only consecutive opposite intervals of the shared symbolic support.
/// Their identical endpoint ids establish a zero directed 1-chain.
fn reduce_chain(mut path: Vec<usize>) -> (Vec<usize>, BTreeSet<usize>, usize) {
    let mut removed = BTreeSet::new();
    let mut count = 0;
    loop {
        path.dedup();
        if path.first() == path.last() {
            path.pop();
        }
        if path.len() < 3 {
            removed.extend(&path);
            return (vec![], removed, count.max(1));
        }
        let Some(i) = (0..path.len())
            .find(|&i| path[(i + path.len() - 1) % path.len()] == path[(i + 1) % path.len()])
        else {
            removed.retain(|id| !path.contains(id));
            return (path, removed, count);
        };
        removed.insert(path.remove(i));
        count += 1;
    }
}

pub(super) fn relocate(
    cells: Surface,
    owners: Vec<usize>,
    faces: &[RawFace],
    domains: &[Surface],
    error: f64,
) -> Result<Relocated, String> {
    let mut index = BTreeMap::<(u64, u64), usize>::new();
    let mut points = vec![];
    let mut incident = Vec::<BTreeSet<usize>>::new();
    let mut shapes = Vec::<Vec<Vec<usize>>>::new();
    for (cell, &owner) in cells.iter().zip(&owners) {
        let mut shape = vec![];
        for ring in std::iter::once(&cell.outer).chain(&cell.holes) {
            let mut path = vec![];
            for &p in ring {
                let id = *index
                    .entry((p.x.to_bits(), p.y.to_bits()))
                    .or_insert_with(|| {
                        let id = points.len();
                        points.push(p);
                        incident.push(BTreeSet::new());
                        id
                    });
                incident[id].insert(owner);
                path.push(id);
            }
            shape.push(path);
        }
        shapes.push(shape);
    }
    let actual_incident = incident.clone();
    let supports = supports::Supports::build(&points, &shapes, domains, faces, error)?;
    let authority = authority::Authority::build(&supports, faces)?;
    for id in 0..points.len() {
        let existing: Vec<_> = incident[id].iter().copied().collect();
        let budget = error
            + existing
                .iter()
                .map(|&i| faces[i].source.overlay_error_m)
                .fold(0.0, f64::max);
        for &segment in &supports.carriers[id] {
            let owner = supports.segments[segment].owner;
            if existing.iter().all(|&i| {
                height_match(
                    &faces[i].source,
                    &faces[owner].source,
                    points[id],
                    2.0 * budget,
                )
            }) {
                incident[id].insert(owner);
            }
        }
    }
    let affine_junction = faces.iter().any(|face| {
        face.source.plane.a != faces[0].source.plane.a
            || face.source.plane.b != faces[0].source.plane.b
    });
    let mut targets = points.clone();
    let mut displacement = 0.0_f64;
    let mut moved = 0;
    let mut nodes = vec![];
    for (id, owners) in incident.iter().enumerate() {
        let budget = error
            + owners
                .iter()
                .map(|&i| faces[i].source.overlay_error_m)
                .fold(0.0, f64::max);
        let node = authority
            .identify(id, points[id], &supports, budget)
            .map_err(|e| {
                format!(
                    "{e} ; provenance {} ; node{}.",
                    authority.provenance(&supports),
                    authority.node_report(id, &supports)
                )
            })?;
        nodes.push(node.clone());
        if !affine_junction {
            continue;
        }
        let p = points[id];
        let source_error = owners
            .iter()
            .map(|&i| faces[i].source.overlay_error_m)
            .fold(0.0, f64::max);
        let budget = error + source_error;
        let sources: Vec<_> = owners.iter().map(|&i| &faces[i].source).collect();
        // A real height step is not an equality constraint; it still shares
        // a certified XY support with its neighbours.
        let real_step = sources.iter().enumerate().any(|(i, a)| {
            sources[i + 1..]
                .iter()
                .any(|b| !height_match(a, b, p, 2.0 * budget))
        });
        let planes: Vec<_> = if real_step {
            vec![sources[0].plane]
        } else {
            sources.iter().map(|s| s.plane).collect()
        };
        let segments = supports.local_segments(id);
        let mut q = if node.identity.is_some() && (planes.len() < 2 || agreed(&planes, node.target))
        {
            node.target
        } else {
            target(p, &planes, &segments, budget)?
        };
        if q == p
            && let Some(projected) = supports.one_class_target(id, p)
        {
            if length(p, projected) > budget {
                return Err("Projection de support Boundary hors borne.".into());
            }
            q = if planes.len() > 1 && !agreed(&planes, projected) {
                target(projected, &planes, &segments, budget - length(p, projected))?
            } else {
                projected
            };
        }
        if length(p, q) > budget {
            return Err("Nœud de support Boundary hors borne.".into());
        }
        if q != p {
            moved += 1;
            displacement = displacement.max(length(p, q));
            targets[id] = q;
        }
    }
    let mut canonical = BTreeMap::<(u64, u64), usize>::new();
    let mut identities = BTreeMap::new();
    let mut roots = vec![];
    for (id, &p) in targets.iter().enumerate() {
        if let Some(identity) = &nodes[id].identity {
            if let Some(&other) = identities.get(identity) {
                if targets[other] != p {
                    return Err(format!(
                        "Même id matériel Boundary avec deux cibles : nœuds{id}/{other}, {:?}/{:?}.",
                        p, targets[other]
                    ));
                }
            } else {
                identities.insert(identity.clone(), id);
            }
        }
        let representative = *canonical
            .entry((p.x.to_bits(), p.y.to_bits()))
            .or_insert(id);
        if representative != id
            && (nodes[id].identity.is_none()
                || nodes[id].identity != nodes[representative].identity)
        {
            return Err(format!(
                "Nœuds Boundary de provenance distincte à même cible : {id}/{representative}, {:?}/{:?}, sources {:?}/{:?}, contraintes {:?}/{:?}. Cartes{} / {}.",
                points[id],
                points[representative],
                nodes[id].identity,
                nodes[representative].identity,
                nodes[id].constraints,
                nodes[representative].constraints,
                authority.node_report(id, &supports),
                authority.node_report(representative, &supports)
            ));
        }
        roots.push(representative);
    }
    let mut result = Relocated {
        cells: vec![],
        owners: vec![],
        moved,
        displacement,
        collapsed: 0,
        collapsed_area: 0.0,
    };
    let mut kept = BTreeSet::new();
    let mut removed_corners = vec![];
    for ((before, shape), owner) in cells.into_iter().zip(shapes).zip(owners) {
        let mut paths = vec![];
        let mut removed = BTreeSet::new();
        let mut count = 0;
        for path in shape {
            let subdivided = supports.subdivide(&path, &targets, &roots)?;
            let (reduced, deleted, cancellations) = reduce_chain(subdivided);
            count += cancellations;
            removed.extend(deleted);
            if reduced.len() < 3 {
                paths.push(vec![]);
                continue;
            }
            kept.extend(reduced.iter().copied());
            paths.push(reduced.iter().map(|&id| targets[id]).collect::<Vec<_>>());
        }
        for &id in &removed {
            if nodes[id].material_corner && actual_incident[id].contains(&owner) {
                removed_corners.push((owner, id));
            }
        }
        let outer = paths.remove(0);
        let holes: Vec<_> = paths.into_iter().filter(|p| !p.is_empty()).collect();
        if outer.is_empty() && !holes.is_empty() {
            return Err("Chaîne Boundary externe nulle avec trou positif.".into());
        }
        let after = if outer.is_empty() {
            vec![]
        } else {
            vec![Polygon { outer, holes }]
        };
        let before_area = area(&vec![before.clone()]);
        let delta = (before_area - area(&after)).abs();
        let perimeter = rings(&vec![before.clone()])
            .map(|r| {
                r.iter()
                    .zip(r.iter().cycle().skip(1))
                    .take(r.len())
                    .map(|(&a, &b)| length(a, b))
                    .sum::<f64>()
            })
            .sum::<f64>();
        let budget = error + faces[owner].source.overlay_error_m;
        let bound = 2.0 * budget * perimeter + 128.0 * ulp(before_area);
        if delta > bound {
            return Err(format!(
                "Sous-chaîne Boundary hors borne d’aire : {} delta{delta:.12} > {bound:.12}.",
                faces[owner].source.group
            ));
        }
        if count > 0 || after.is_empty() {
            result.collapsed += count.max(1);
            result.collapsed_area += delta;
        }
        if !after.is_empty() {
            result.cells.extend(after);
            result.owners.push(owner);
        }
    }
    for (owner, id) in removed_corners {
        if !kept.contains(&id) {
            return Err(format!(
                "Coin matériel Boundary retiré sans cellule voisine : {} nœud{id}, provenance {:?}.",
                faces[owner].source.group, nodes[id].identity
            ));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_planes_meet_at_one_certified_graph_node() {
        let planes = [
            Plane {
                a: 0.0,
                b: 0.0,
                c: 0.0,
            },
            Plane {
                a: 1.0,
                b: 0.0,
                c: -2.0,
            },
            Plane {
                a: 0.0,
                b: 1.0,
                c: -3.0,
            },
        ];
        assert_eq!(
            target(
                Point {
                    x: 2.0 + 1e-8,
                    y: 3.0 - 1e-8
                },
                &planes,
                &[],
                1e-6
            )
            .unwrap(),
            Point { x: 2.0, y: 3.0 }
        );
    }
    #[test]
    fn square_capture_moves_to_the_actual_affine_ridge() {
        let slope = 0.6370702608074932;
        let planes = [
            Plane {
                a: slope,
                b: 0.0,
                c: 15.34,
            },
            Plane {
                a: 0.0,
                b: slope,
                c: 15.34,
            },
        ];
        let point = Point {
            x: 3.9499999284744227,
            y: 3.9499999955296516,
        };
        let relocated = target(point, &planes, &[], 1e-7).unwrap();
        assert_eq!(relocated.x, relocated.y);
        assert!(length(point, relocated) < 5e-8);
    }
    #[test]
    fn a_zero_chain_is_distinguished_from_a_positive_microfacet() {
        assert!(null_chain(&Polygon {
            outer: vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 2.0 },
                Point { x: 3.0, y: 3.0 }
            ],
            holes: vec![]
        }));
        assert!(!null_chain(&Polygon {
            outer: vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 10.0, y: 0.0 },
                Point { x: 10.0, y: 1e-12 }
            ],
            holes: vec![]
        }));
    }
    #[test]
    fn a_null_excursion_is_cancelled_inside_a_positive_cell() {
        let points = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 4.0, y: 0.0 },
            Point { x: 4.0, y: 4.0 },
            Point { x: 2.0, y: 4.0 },
            Point { x: 3.0, y: 4.0 },
            Point { x: 2.0, y: 4.0 },
            Point { x: 0.0, y: 4.0 },
        ];
        let raw = super::super::tests::face(points, "excursion", 1e-7);
        let domains = vec![raw.source.domain.clone()];
        let relocated = relocate(domains[0].clone(), vec![0], &[raw], &domains, 1e-7).unwrap();
        assert_eq!(area(&relocated.cells), 16.0);
        assert!(relocated.collapsed > 0);
        let ring = &relocated.cells[0].outer;
        assert!(
            (0..ring.len())
                .all(|i| ring[(i + ring.len() - 1) % ring.len()] != ring[(i + 1) % ring.len()])
        );
    }
    #[test]
    fn positive_ten_nanometer_excursion_cannot_merge_two_material_corners() {
        let points = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 4.0, y: 0.0 },
            Point { x: 4.0, y: 4.0 },
            Point { x: 2.0, y: 4.0 },
            Point {
                x: 3.0,
                y: 4.0 + 1e-8,
            },
            Point { x: 3.0, y: 4.0 },
            Point { x: 0.0, y: 4.0 },
        ];
        let raw = super::super::tests::face(points, "positive", 1e-7);
        let domains = vec![raw.source.domain.clone()];
        let result = relocate(domains[0].clone(), vec![0], &[raw], &domains, 1e-7);
        assert!(
            result.is_err(),
            "positive material excursion must be preserved or rejected"
        );
    }
    #[test]
    fn symbolic_round_capture_cancels_the_return_but_keeps_its_subdivisions() {
        let (path, removed, count) = reduce_chain(vec![18, 20, 21, 19, 21, 20, 21, 0]);
        assert_eq!(path, vec![18, 20, 21, 0]);
        assert_eq!(removed, BTreeSet::from([19]));
        assert_eq!(count, 2);
    }
}
