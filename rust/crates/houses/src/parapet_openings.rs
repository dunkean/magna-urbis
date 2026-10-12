//! Local, finite cuts of roof parapets. A passage never erases a whole rive.
use super::*;
use geo::line_intersection::{LineIntersection, line_intersection};
use geo::{Contains, Coord, Intersects, Line, MultiPolygon};

#[derive(Clone, Debug, PartialEq, Eq)]
struct BoundaryHit {
    portal: usize,
    ring: usize,
    edge: usize,
}

#[derive(Clone, Debug)]
struct Stop {
    t: f64,
    point: Point,
    hits: Vec<BoundaryHit>,
}

#[derive(Clone, Copy, Debug)]
struct Piece {
    lo: usize,
    hi: usize,
}

struct EdgeCuts {
    stops: Vec<Stop>,
    opened: Vec<BTreeSet<usize>>,
    collinear: Vec<(usize, f64, f64)>,
    pieces: Vec<Piece>,
}

fn eligible(portal: &Portal, z: f64, height: f64) -> bool {
    ((portal.from_z_m - z).abs() <= 0.001 || (portal.to_z_m - z).abs() <= 0.001)
        && match portal.kind {
            PortalKind::Hatch => false,
            PortalKind::Stair | PortalKind::Ladder => true,
            _ => portal.head_z_m >= z + height,
        }
}

fn coord(p: Point) -> Coord<f64> {
    Coord { x: p.x, y: p.y }
}

fn at(a: Point, b: Point, t: f64) -> Point {
    if t == 0.0 {
        a
    } else if t == 1.0 {
        b
    } else {
        Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        }
    }
}

fn intersection_stop(a: Point, b: Point, p: Coord<f64>, hit: BoundaryHit) -> Stop {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dominant_x = dx.abs() >= dy.abs();
    let t = if dominant_x {
        (p.x - a.x) / dx
    } else {
        (p.y - a.y) / dy
    }
    .clamp(0.0, 1.0);
    let mut position = at(a, b, t);
    // Copy the native dominant coordinate, rather than round-trip it through t.
    // A diagonal's boundary identity is the hit provenance, not f64 collinearity.
    if t > 0.0 && t < 1.0 {
        if dominant_x {
            position.x = p.x;
        } else {
            position.y = p.y;
        }
    }
    Stop {
        t,
        point: position,
        hits: vec![hit],
    }
}

fn edge_cuts(a: Point, b: Point, z: f64, height: f64, portals: &[Portal]) -> EdgeCuts {
    let mut stops = vec![
        Stop {
            t: 0.0,
            point: a,
            hits: vec![],
        },
        Stop {
            t: 1.0,
            point: b,
            hits: vec![],
        },
    ];
    let mut collinear = vec![];
    let mut passages: Vec<(usize, MultiPolygon<f64>)> = vec![];
    if a != b {
        for (portal_index, portal) in portals
            .iter()
            .enumerate()
            .filter(|(_, p)| eligible(p, z, height))
        {
            passages.push((portal_index, g::to_geo(&portal.passage)));
            for (ring_index, ring) in portal
                .passage
                .iter()
                .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
                .enumerate()
            {
                for (edge_index, (&p, &q)) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                    .enumerate()
                {
                    let hit = BoundaryHit {
                        portal: portal_index,
                        ring: ring_index,
                        edge: edge_index,
                    };
                    match line_intersection(
                        Line::new(coord(a), coord(b)),
                        Line::new(coord(p), coord(q)),
                    ) {
                        Some(LineIntersection::SinglePoint { intersection, .. }) => {
                            stops.push(intersection_stop(a, b, intersection, hit));
                        }
                        Some(LineIntersection::Collinear { intersection }) => {
                            let start = intersection_stop(a, b, intersection.start, hit.clone());
                            let end = intersection_stop(a, b, intersection.end, hit);
                            collinear.push((portal_index, start.t.min(end.t), start.t.max(end.t)));
                            stops.extend([start, end]);
                        }
                        None => {}
                    }
                }
            }
        }
    }
    stops.sort_by(|a, b| a.t.total_cmp(&b.t));
    let mut unique: Vec<Stop> = vec![];
    for stop in stops {
        if let Some(previous) = unique.last_mut().filter(|previous| previous.t == stop.t) {
            previous.hits.extend(stop.hits);
        } else {
            unique.push(stop);
        }
    }
    let opened: Vec<BTreeSet<usize>> = unique
        .windows(2)
        .map(|range| {
            let p = at(a, b, range[0].t + (range[1].t - range[0].t) * 0.5);
            let p = geo::Point::new(p.x, p.y);
            passages
                .iter()
                .filter(|(_, geometry)| geometry.contains(&p))
                .map(|(id, _)| *id)
                .collect()
        })
        .collect();
    let mut pieces: Vec<Piece> = vec![];
    for (i, cell) in opened.iter().enumerate() {
        if cell.is_empty() {
            if let Some(previous) = pieces.last_mut().filter(|piece| piece.hi == i) {
                previous.hi = i + 1;
            } else {
                pieces.push(Piece { lo: i, hi: i + 1 });
            }
        }
    }
    EdgeCuts {
        stops: unique,
        opened,
        collinear,
        pieces,
    }
}

pub(super) fn retained_segments(
    a: Point,
    b: Point,
    z: f64,
    height: f64,
    portals: &[Portal],
) -> Vec<(Point, Point)> {
    let cut = edge_cuts(a, b, z, height, portals);
    cut.pieces
        .iter()
        .map(|piece| (cut.stops[piece.lo].point, cut.stops[piece.hi].point))
        .collect()
}

struct NativePiece {
    frame: [Vertex3; 4],
    jambs: [bool; 2],
}

fn quantized(v: &Vertex3) -> Vertex3 {
    let (x, y, z) = vertex_key(v);
    Vertex3 {
        x: x as f64 * 0.000_001,
        y: y as f64 * 0.000_001,
        z: z as f64 * 0.001,
    }
}

fn has_boundary_provenance(
    stop: &Stop,
    a: Point,
    b: Point,
    portals: &[Portal],
    portal_index: usize,
) -> bool {
    stop.hits
        .iter()
        .filter(|hit| hit.portal == portal_index)
        .any(|hit| {
            let Some(ring) = portals[hit.portal]
                .passage
                .iter()
                .flat_map(|polygon| std::iter::once(&polygon.outer).chain(&polygon.holes))
                .nth(hit.ring)
            else {
                return false;
            };
            let p = ring[hit.edge];
            let q = ring[(hit.edge + 1) % ring.len()];
            match line_intersection(Line::new(coord(a), coord(b)), Line::new(coord(p), coord(q))) {
                Some(LineIntersection::SinglePoint { intersection, .. }) => {
                    intersection_stop(a, b, intersection, hit.clone()).t == stop.t
                }
                Some(LineIntersection::Collinear { intersection }) => {
                    [intersection.start, intersection.end]
                        .into_iter()
                        .any(|p| intersection_stop(a, b, p, hit.clone()).t == stop.t)
                }
                None => false,
            }
        })
}

fn native_pieces(
    domain: &Surface,
    z: f64,
    height: f64,
    portals: &[Portal],
    portal_index: usize,
) -> Vec<NativePiece> {
    let passage = g::to_geo(&portals[portal_index].passage);
    let mut result = vec![];
    for polygon in domain {
        let ring = &polygon.outer;
        let cuts: Vec<_> = ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
            .map(|(&a, &b)| edge_cuts(a, b, z, height, portals))
            .collect();
        for (edge, cut) in cuts.iter().enumerate() {
            for piece in &cut.pieces {
                let start = &cut.stops[piece.lo];
                let end = &cut.stops[piece.hi];
                let before = if piece.lo > 0 {
                    cut.opened[piece.lo - 1].contains(&portal_index)
                } else {
                    cuts[(edge + cuts.len() - 1) % cuts.len()]
                        .opened
                        .last()
                        .is_some_and(|opened| opened.contains(&portal_index))
                };
                let after = if piece.hi < cut.opened.len() {
                    cut.opened[piece.hi].contains(&portal_index)
                } else {
                    cuts[(edge + 1) % cuts.len()]
                        .opened
                        .first()
                        .is_some_and(|opened| opened.contains(&portal_index))
                };
                // Boundary provenance is attached to finite intersections before
                // interpolation. In particular, diagonal jambs need not have
                // f64 coordinates exactly collinear with the portal's edge.
                let mut jambs = [
                    before
                        && has_boundary_provenance(
                            start,
                            ring[edge],
                            ring[(edge + 1) % ring.len()],
                            portals,
                            portal_index,
                        ),
                    after
                        && has_boundary_provenance(
                            end,
                            ring[edge],
                            ring[(edge + 1) % ring.len()],
                            portals,
                            portal_index,
                        ),
                ];
                let foreign_hit =
                    cut.stops[piece.lo..=piece.hi]
                        .iter()
                        .enumerate()
                        .any(|(i, stop)| {
                            stop.hits.iter().any(|hit| hit.portal == portal_index)
                                && !((i == 0 && jambs[0]) || (i == piece.hi - piece.lo && jambs[1]))
                        });
                let boundary_overlap = cut
                    .collinear
                    .iter()
                    .any(|&(id, lo, hi)| id == portal_index && lo.max(start.t) < hi.min(end.t));
                let closed_interior = (piece.lo..piece.hi).any(|i| {
                    let mid = at(
                        ring[edge],
                        ring[(edge + 1) % ring.len()],
                        cut.stops[i].t + (cut.stops[i + 1].t - cut.stops[i].t) * 0.5,
                    );
                    passage.intersects(&geo::Point::new(mid.x, mid.y))
                });
                if foreign_hit || boundary_overlap || closed_interior {
                    jambs = [false; 2];
                }
                let a = start.point;
                let b = end.point;
                result.push(NativePiece {
                    frame: [
                        Vertex3 { x: a.x, y: a.y, z },
                        Vertex3 { x: b.x, y: b.y, z },
                        Vertex3 {
                            x: b.x,
                            y: b.y,
                            z: z + height,
                        },
                        Vertex3 {
                            x: a.x,
                            y: a.y,
                            z: z + height,
                        },
                    ],
                    jambs,
                });
            }
        }
    }
    result
}

fn matches_frame(vertices: &[&Vertex3], frame: &[Vertex3; 4]) -> bool {
    let expected = frame.each_ref().map(vertex_key);
    let keys: Vec<_> = vertices.iter().map(|v| vertex_key(v)).collect();
    if keys.first() != Some(&expected[0])
        || keys.iter().collect::<BTreeSet<_>>().len() != keys.len()
    {
        return false;
    }
    let Some(positions) = expected
        .iter()
        .map(|key| keys.iter().position(|k| k == key))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    if !positions.windows(2).all(|p| p[0] < p[1]) {
        return false;
    }
    let frame = frame.each_ref().map(quantized);
    // Preserve the assembler's existing T subdivisions. Their proximity alone
    // never grants an exemption: every unrelated sub-edge is still tested by
    // the access validator, and the other endpoint of an own edge is outside P.
    for corner in 0..4 {
        let end = if corner == 3 {
            vertices.len()
        } else {
            positions[corner + 1]
        };
        if vertices[positions[corner] + 1..end]
            .iter()
            .any(|v| on_segment(v, &frame[corner], &frame[(corner + 1) % 4]).is_none())
        {
            return false;
        }
    }
    true
}

/// Certified sub-edges only. The caller retains its closed Intersects guard
/// on every other edge and feature; this is not a tolerance on collisions.
pub(crate) fn parapet_jamb_edges(
    unit: &HouseUnit,
    portal: &Portal,
    target_part: &Surface,
    z: f64,
    group: &str,
) -> Result<BTreeSet<(usize, usize)>, String> {
    let error = |reason: &str| {
        format!(
            "Certificat de jambage propre {} / {group} : {reason}.",
            portal.id
        )
    };
    let portals: Vec<_> = unit
        .access
        .portals
        .iter()
        .enumerate()
        .filter(|(_, p)| *p == portal)
        .collect();
    if portals.len() != 1 {
        return Err(error("portail absent ou ambigu"));
    }
    let portal_index = portals[0].0;
    let sources = roof_sources(unit)?;
    // Boundary has its own precision authority. No legacy certificate is
    // transferred to it, including when another source selects that assembler.
    if sources.iter().any(|source| source.boundary_triangulation) {
        return Err(error("maillage Boundary hors certificat legacy"));
    }
    let sources: Vec<_> = sources
        .iter()
        .filter(|source| {
            source.group == group
                && source.feature_id.is_none()
                && ["RF-FLAT", "RF-STEP"].contains(&source.roof_system.as_str())
        })
        .collect();
    if sources.len() != 1 {
        return Err(error("source native absente ou ambiguë"));
    }
    let source = sources[0];
    let native_z = source.support_z_m;
    let height = source.roof_spec.parapet_height_m;
    if (native_z - z).abs() > 0.001 || height <= 0.0 || !eligible(portal, native_z, height) {
        return Err(error("cote ou ouverture sans parapet éligible"));
    }
    let mut domain = top_covers(
        unit,
        source,
        &source.level,
        native_z,
        &roof_domain(unit, source, &source.level),
    );
    if let Some(slab) = &source.level.roof_slab {
        domain = intersection(&domain, &slab.surface);
    }
    let terminal = unit.access.nodes.iter().any(|node| {
        node.id == portal.to
            && node.kind == AccessKind::Terrace
            && (node.z_m - z).abs() <= 0.001
            && area(&intersection(
                target_part,
                &intersection(&node.floor, &domain),
            )) > 1e-6
    });
    let terminal = if terminal {
        true
    } else if matches!(portal.kind, PortalKind::Stair | PortalKind::Ladder) {
        let terminals: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|node| {
                (node.id == portal.from || node.id == portal.to) && (node.z_m - z).abs() <= 0.001
            })
            .collect();
        let flights: Vec<_> = unit
            .features
            .iter()
            .filter(|feature| {
                portal.feature_ids.contains(&feature.id)
                    && feature.kind == FeatureKind::Ladder
                    && feature.vertices3d.len() == 4
                    && feature.vertices3d[..2]
                        .iter()
                        .all(|v| (v.z - portal.from_z_m).abs() <= 0.001)
                    && feature.vertices3d[2..]
                        .iter()
                        .all(|v| (v.z - portal.to_z_m).abs() <= 0.001)
            })
            .collect();
        terminals.len() == 1
            && terminals[0].id == portal.from
            && terminals[0].kind == AccessKind::Terrace
            && terminals[0].household_id.is_none()
            && crate::access::public_reachable(unit).contains(&terminals[0].id)
            && flights.len() == 1
            && crate::access::public_roof_low_band(flights[0]).is_some_and(|band| {
                target_part == &band
                    && area(&intersection(
                        &band,
                        &intersection(&terminals[0].floor, &domain),
                    )) >= 0.85 * 0.9 * 0.35
            })
    } else {
        false
    };
    if !terminal {
        return Err(error("terminal Terrace non porté par la source"));
    }
    let pieces: Vec<_> = native_pieces(
        &domain,
        native_z,
        height,
        &unit.access.portals,
        portal_index,
    )
    .into_iter()
    .filter(|piece| {
        let frame = piece.frame.each_ref().map(quantized);
        // This mirrors existing legacy emission, not a new raw-piece filter.
        normal(&frame).is_some() && frame.iter().map(vertex_key).collect::<BTreeSet<_>>().len() >= 3
    })
    .collect();
    let faces: Vec<_> = unit
        .roofs
        .faces
        .iter()
        .enumerate()
        .filter(|(_, face)| face.roof_group == group && face.kind == RoofFaceKind::Parapet)
        .collect();
    if pieces.len() != faces.len() {
        return Err(error("nombre de faces différent des morceaux natifs"));
    }
    let geometry = g::to_geo(&portal.passage);
    let mut used = BTreeSet::new();
    let mut allowed = BTreeSet::new();
    for (face_index, face) in faces {
        if face.body_id != source.body_id
            || face.level != source.level.index
            || face.feature_id.is_some()
            || face.rf != source.roof_system
            || face.component_id != source.component_id
            || face.material != source.level.materials.infill
            || face.normal[2] != 0.0
        {
            return Err(error("provenance de face différente"));
        }
        let vertices = face
            .vertices
            .iter()
            .map(|&id| unit.roofs.vertices.get(id as usize))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| error("indice de sommet invalide"))?;
        let matched: Vec<_> = pieces
            .iter()
            .enumerate()
            .filter(|(_, piece)| matches_frame(&vertices, &piece.frame))
            .collect();
        if matched.len() != 1 || !used.insert(matched[0].0) {
            return Err(error("face ajoutée, retriangulée, dupliquée ou ambiguë"));
        }
        let piece = matched[0].1;
        let jamb_keys: BTreeSet<_> = [0, 1]
            .into_iter()
            .filter(|&i| piece.jambs[i])
            .map(|i| {
                let k = vertex_key(&piece.frame[i]);
                (k.0, k.1)
            })
            .collect();
        for (edge, (a, b)) in vertices
            .iter()
            .zip(vertices.iter().cycle().skip(1))
            .take(vertices.len())
            .enumerate()
        {
            let ka = vertex_key(a);
            let kb = vertex_key(b);
            let own_a = jamb_keys.contains(&(ka.0, ka.1));
            let own_b = jamb_keys.contains(&(kb.0, kb.1));
            let outside = |v: &Vertex3| !geometry.intersects(&geo::Point::new(v.x, v.y));
            let own_contact = if own_a && own_b {
                (ka.0, ka.1) == (kb.0, kb.1) || {
                    // A hole may have two own jambs. Certify both half-segments
                    // against their common exterior midpoint, without changing
                    // either the Mesh or its native geometric pieces.
                    let mid = geo::Point::new(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5);
                    !geometry.intersects(&mid)
                }
            } else {
                (own_a && outside(b)) || (own_b && outside(a))
            };
            if own_contact {
                allowed.insert((face_index, edge));
            }
        }
    }
    Ok(allowed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangle(x: f64, y: f64, w: f64, d: f64) -> Surface {
        vec![Polygon {
            outer: vec![
                Point { x, y },
                Point { x: x + w, y },
                Point { x: x + w, y: y + d },
                Point { x, y: y + d },
            ],
            holes: vec![],
        }]
    }

    fn passage(id: &str, surface: Surface, z: f64) -> Portal {
        Portal {
            id: id.into(),
            kind: PortalKind::Passage,
            from: "a".into(),
            to: "b".into(),
            opening: [Point { x: 0.0, y: 0.0 }, Point { x: 0.85, y: 0.0 }],
            wall_id: None,
            feature_ids: vec![],
            opening_surface: surface.clone(),
            passage: surface,
            width_m: 0.85,
            from_z_m: z,
            to_z_m: z,
            head_z_m: z + 2.05,
            shape: crate::catalogue::PortalShape::Rect,
            top_width_m: None,
            sill_z_m: None,
            profile_id: None,
        }
    }

    fn spans(portals: &[Portal]) -> Vec<(f64, f64)> {
        retained_segments(
            Point { x: 0.0, y: 0.0 },
            Point { x: 12.0, y: 0.0 },
            3.0,
            0.4,
            portals,
        )
        .into_iter()
        .map(|(a, b)| (a.x, b.x))
        .collect()
    }

    #[test]
    fn central_and_end_openings_preserve_the_rest_of_the_rive() {
        assert_eq!(
            spans(&[passage("center", rectangle(5.0, -1.0, 0.85, 2.0), 3.0)]),
            vec![(0.0, 5.0), (5.85, 12.0)]
        );
        assert_eq!(
            spans(&[passage("end", rectangle(-1.0, -1.0, 2.0, 2.0), 3.0)]),
            vec![(1.0, 12.0)]
        );
        assert_eq!(
            spans(&[passage("all", rectangle(-1.0, -1.0, 14.0, 2.0), 3.0)]),
            vec![]
        );
    }

    #[test]
    fn cumulative_openings_are_unioned_and_holes_remain_closed() {
        let a = passage("a", rectangle(2.0, -1.0, 3.0, 2.0), 3.0);
        let b = passage("b", rectangle(4.0, -1.0, 4.0, 2.0), 3.0);
        assert_eq!(
            spans(&[a.clone(), b.clone()]),
            vec![(0.0, 2.0), (8.0, 12.0)]
        );
        let mut hole = rectangle(3.0, -0.5, 1.0, 1.0)[0].outer.clone();
        hole.reverse();
        let mut a = a;
        a.passage[0].holes.push(hole);
        assert_eq!(spans(&[a, b]), vec![(0.0, 2.0), (3.0, 4.0), (8.0, 12.0)]);
    }

    #[test]
    fn point_and_collinear_contacts_and_two_foreign_anys_do_not_open() {
        let correct_z_far_away = passage("a", rectangle(2.0, 5.0, 1.0, 1.0), 3.0);
        let wrong_z_on_rive = passage("b", rectangle(2.0, -1.0, 1.0, 2.0), 0.0);
        let collinear = passage("collinear", rectangle(5.0, 0.0, 1.0, 1.0), 3.0);
        let tangent = passage(
            "tangent",
            vec![Polygon {
                outer: vec![
                    Point { x: 8.0, y: 0.0 },
                    Point { x: 9.0, y: 1.0 },
                    Point { x: 7.0, y: 1.0 },
                ],
                holes: vec![],
            }],
            3.0,
        );
        assert_eq!(
            spans(&[correct_z_far_away, wrong_z_on_rive, collinear, tangent]),
            vec![(0.0, 12.0)]
        );
    }

    #[test]
    fn hatch_and_low_heads_do_not_cancel_a_real_ladder_opening() {
        let mut hatch = passage("hatch", rectangle(1.0, -1.0, 2.0, 2.0), 3.0);
        hatch.kind = PortalKind::Hatch;
        let mut low = passage("low", rectangle(4.0, -1.0, 1.0, 2.0), 3.0);
        low.kind = PortalKind::Door;
        low.head_z_m = 3.2;
        assert_eq!(spans(&[hatch, low.clone()]), vec![(0.0, 12.0)]);
        let mut ladder = passage("ladder", low.passage.clone(), 0.0);
        ladder.kind = PortalKind::Ladder;
        ladder.to_z_m = 3.0;
        ladder.head_z_m = 2.05;
        assert_eq!(spans(&[low, ladder]), vec![(0.0, 4.0), (5.0, 12.0)]);
    }

    #[test]
    fn every_positive_microfragment_is_kept_before_legacy_assembly() {
        let gap = 1e-10;
        let portals = [
            passage("a", rectangle(1.0, -1.0, 4.0, 2.0), 3.0),
            passage("b", rectangle(5.0 + gap, -1.0, 5.0 - gap, 2.0), 3.0),
        ];
        let result = spans(&portals);
        assert_eq!(result, vec![(0.0, 1.0), (5.0, 5.0 + gap), (10.0, 12.0)]);
        assert!(result[1].1 - result[1].0 > 0.0);
        let retained: f64 = result.iter().map(|(a, b)| b - a).sum();
        let opened = 4.0 + (5.0 - gap);
        assert!((retained + opened - 12.0).abs() < 2e-15);
    }

    #[test]
    fn dominant_intersection_coordinate_and_untouched_endpoints_are_copied() {
        let x = 3.123456789012345;
        let result = retained_segments(
            Point { x: 0.0, y: 0.0 },
            Point { x: 12.0, y: 0.0 },
            3.0,
            0.4,
            &[passage("a", rectangle(x, -1.0, 1.0, 2.0), 3.0)],
        );
        assert_eq!(result[0].1.x.to_bits(), x.to_bits());
        let a = Point {
            x: 1.234567890123456,
            y: 2.345678901234567,
        };
        let b = Point {
            x: 8.765432109876543,
            y: 9.876543210987654,
        };
        assert_eq!(retained_segments(a, b, 3.0, 0.4, &[]), vec![(a, b)]);
    }

    #[test]
    fn diagonal_corner_and_hole_jambs_keep_native_boundary_provenance() {
        let triangle = vec![Polygon {
            outer: vec![
                Point { x: -1.0, y: -1.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: -1.0, y: 2.0 },
            ],
            holes: vec![],
        }];
        let pieces = native_pieces(
            &rectangle(0.0, 0.0, 12.0, 8.0),
            3.0,
            0.4,
            &[passage("corner", triangle, 3.0)],
            0,
        );
        assert!(
            pieces
                .iter()
                .any(|piece| piece.frame[0].x == 0.0 && piece.frame[0].y == 0.0 && piece.jambs[0])
        );
        let mut portal = passage("hole", rectangle(2.0, -1.0, 6.0, 2.0), 3.0);
        let mut hole = rectangle(4.0, -0.5, 2.0, 1.0)[0].outer.clone();
        hole.reverse();
        portal.passage[0].holes.push(hole);
        let pieces = native_pieces(&rectangle(0.0, 0.0, 12.0, 8.0), 3.0, 0.4, &[portal], 0);
        assert!(pieces.iter().any(|piece| piece.frame[0].x == 4.0
            && piece.frame[1].x == 6.0
            && piece.jambs == [true; 2]));
        let portal = passage("diagonal", rectangle(3.0, -1.0, 2.0, 6.0), 3.0);
        assert_eq!(
            retained_segments(
                Point { x: 0.0, y: 0.0 },
                Point { x: 8.0, y: 8.0 },
                3.0,
                0.4,
                &[portal]
            ),
            vec![
                (Point { x: 0.0, y: 0.0 }, Point { x: 3.0, y: 3.0 }),
                (Point { x: 5.0, y: 5.0 }, Point { x: 8.0, y: 8.0 })
            ]
        );
    }

    fn him2() -> HouseUnit {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/houses/parapet-him2.json"))
                .unwrap();
        let mut unit: HouseUnit = serde_json::from_value(fixture["unit"].clone()).unwrap();
        build_roofs(&mut unit).unwrap();
        unit
    }

    fn certificate(unit: &HouseUnit) -> Result<BTreeSet<(usize, usize)>, String> {
        let portal = unit
            .access
            .portals
            .iter()
            .find(|p| p.id == "unit-2:portal:54")
            .unwrap();
        let node = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == portal.to)
            .unwrap();
        let target = intersection(&portal.passage, &node.floor);
        let group = unit
            .roofs
            .faces
            .iter()
            .find(|f| {
                f.kind == RoofFaceKind::Parapet && f.body_id == "unit-2:body:3" && f.level == 1
            })
            .unwrap()
            .roof_group
            .clone();
        parapet_jamb_edges(unit, portal, &target, node.z_m, &group)
    }

    #[test]
    fn captured_him2_jambs_are_owned_and_tampering_stays_rejected() {
        let unit = him2();
        let allowed = certificate(&unit).unwrap();
        assert!(!allowed.is_empty());
        let own_face = allowed.first().unwrap().0;
        let mut duplicate = unit.clone();
        duplicate
            .roofs
            .faces
            .push(duplicate.roofs.faces[own_face].clone());
        assert!(
            certificate(&duplicate)
                .unwrap_err()
                .contains("nombre de faces")
        );
        let mut foreign_body = unit.clone();
        foreign_body.roofs.faces[own_face].body_id = "foreign".into();
        assert!(
            certificate(&foreign_body)
                .unwrap_err()
                .contains("provenance")
        );
        let mut lower_z = unit.clone();
        let vertex = lower_z.roofs.faces[own_face].vertices[0] as usize;
        lower_z.roofs.vertices[vertex].z -= 0.001;
        assert!(certificate(&lower_z).is_err());
        let mut extended = unit.clone();
        let vertex = extended.roofs.faces[own_face].vertices[1] as usize;
        extended.roofs.vertices[vertex].y += 0.01;
        assert!(certificate(&extended).is_err());
        let mut boundary = unit;
        boundary.bodies[0].roof_spec.triangulation = Some(RoofTriangulation::Boundary);
        assert!(certificate(&boundary).unwrap_err().contains("Boundary"));
    }

    #[test]
    fn flat_details_emits_the_positive_microfragment_with_original_height_and_material() {
        let mut unit = him2();
        let gap = 1e-10;
        unit.access.portals = vec![
            passage("a", rectangle(1.0, -1.0, 4.0, 2.0), 3.0),
            passage("b", rectangle(5.0 + gap, -1.0, 5.0 - gap, 2.0), 3.0),
        ];
        let sources = body_sources(&unit);
        let source = &sources[0];
        let template = template(
            source,
            &source.level,
            3.0,
            "RF-FLAT",
            source.group.clone(),
            source.layer.clone(),
            RoofFaceKind::Slab,
        );
        let mut raw = vec![];
        let mut features = vec![];
        flat_details(
            &unit,
            source,
            &template,
            &rectangle(0.0, 0.0, 12.0, 8.0),
            3.0,
            &mut raw,
            &mut features,
        );
        let tiny = raw
            .iter()
            .find(|face| face.vertices[0].x == 5.0 && face.vertices[1].x == 5.0 + gap)
            .unwrap();
        assert!(tiny.vertices[1].x > tiny.vertices[0].x);
        assert_eq!(raw.len(), 6);
        for face in &raw {
            assert_eq!(face.source.kind, RoofFaceKind::Parapet);
            assert_eq!(face.source.material, source.level.materials.infill);
            assert_eq!(face.vertices[0].z, 3.0);
            assert_eq!(face.vertices[1].z, 3.0);
            assert_eq!(face.vertices[2].z, 3.0 + source.roof_spec.parapet_height_m);
            assert_eq!(face.vertices[3].z, 3.0 + source.roof_spec.parapet_height_m);
        }
        assert!(features[0].id.ends_with(":drain:4"));
    }

    #[test]
    fn a_low_door_retriangulating_the_group_gets_no_legacy_jamb_exemption() {
        let mut unit = him2();
        let mut door = unit
            .access
            .portals
            .iter()
            .find(|p| p.id == "unit-2:portal:54")
            .unwrap()
            .clone();
        door.id = "low-door-negative".into();
        door.kind = PortalKind::Door;
        door.head_z_m = 5.8;
        door.opening = [Point { x: 14.972, y: 16.2 }, Point { x: 14.972, y: 16.6 }];
        door.passage = rectangle(14.772, 16.2, 0.462, 0.4);
        door.opening_surface = door.passage.clone();
        unit.access.portals.push(door);
        build_roofs(&mut unit).unwrap();
        let reason = certificate(&unit).unwrap_err();
        assert!(
            reason.contains("nombre de faces") || reason.contains("retriangulée"),
            "{reason}"
        );
    }

    #[test]
    fn lower_terminal_requires_the_real_same_portal_band_and_a_public_terrace() {
        let mut unit = him2();
        let surface = rectangle(14.672, 15.1, 1.3, 0.9);
        let feature = roof_feature(
            "lower-proof-ladder".into(),
            FeatureKind::Ladder,
            surface.clone(),
            5.6,
            0.9,
            "MAT-TIMBER-POST".into(),
            vec![
                Vertex3 {
                    x: 14.672,
                    y: 15.1,
                    z: 5.6,
                },
                Vertex3 {
                    x: 14.672,
                    y: 16.0,
                    z: 5.6,
                },
                Vertex3 {
                    x: 15.972,
                    y: 16.0,
                    z: 6.5,
                },
                Vertex3 {
                    x: 15.972,
                    y: 15.1,
                    z: 6.5,
                },
            ],
        );
        let low = crate::access::public_roof_low_band(&feature).unwrap();
        let mut portal = passage("lower-proof-portal", surface, 5.6);
        portal.kind = PortalKind::Ladder;
        portal.from = "unit-2:space:24".into();
        portal.to = "lower-proof-upper".into();
        portal.to_z_m = 6.5;
        portal.feature_ids = vec![feature.id.clone()];
        unit.features.push(feature);
        unit.access.nodes.push(AccessNode {
            id: portal.to.clone(),
            kind: AccessKind::Terrace,
            floor: rectangle(15.672, 15.1, 0.3, 0.9),
            z_m: 6.5,
            household_id: None,
        });
        unit.access.portals.push(portal.clone());
        build_roofs(&mut unit).unwrap();
        let group = unit
            .roofs
            .faces
            .iter()
            .find(|f| {
                f.kind == RoofFaceKind::Parapet && f.body_id == "unit-2:body:3" && f.level == 1
            })
            .unwrap()
            .roof_group
            .clone();
        assert!(
            !parapet_jamb_edges(&unit, &portal, &low, 5.6, &group)
                .unwrap()
                .is_empty()
        );
        let mut different_band = low.clone();
        different_band[0].outer[0].x += 0.001;
        assert!(parapet_jamb_edges(&unit, &portal, &different_band, 5.6, &group).is_err());
        let mut private = unit.clone();
        private
            .access
            .nodes
            .iter_mut()
            .find(|node| node.id == portal.from)
            .unwrap()
            .household_id = Some("private".into());
        assert!(parapet_jamb_edges(&private, &portal, &low, 5.6, &group).is_err());
        let mut missing_flight = unit.clone();
        missing_flight
            .features
            .retain(|feature| feature.id != "lower-proof-ladder");
        assert!(parapet_jamb_edges(&missing_flight, &portal, &low, 5.6, &group).is_err());
        let mut horizontal = unit;
        let original = horizontal
            .access
            .portals
            .iter_mut()
            .find(|p| p.id == portal.id)
            .unwrap();
        original.kind = PortalKind::Door;
        let original = original.clone();
        assert!(parapet_jamb_edges(&horizontal, &original, &low, 5.6, &group).is_err());
    }
}
