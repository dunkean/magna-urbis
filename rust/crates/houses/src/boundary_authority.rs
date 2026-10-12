//! Material operands and creation ids are authoritative; boolean vertices are not.
use super::*;

#[derive(Clone, Debug)]
enum Kind {
    Edge {
        a: Point,
        b: Point,
    },
    Equality {
        first: Plane,
        second: Plane,
        keys: [PlanKey; 2],
    },
}

type PlanKey = (String, usize);
#[derive(Clone, Debug)]
struct Support {
    name: String,
    kind: Kind,
    members: Vec<(Point, Point)>,
}
#[derive(Clone, Debug)]
struct Vertex {
    point: Point,
    supports: [usize; 2],
}
pub(super) struct Authority {
    supports: Vec<Support>,
    vertices: Vec<Vertex>,
    segment_ids: Vec<Option<usize>>,
    segment_candidates: Vec<Vec<usize>>,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Identity {
    Intersection(usize, usize),
    Steiner(usize, u64, u64),
}
#[derive(Clone, Debug)]
pub(super) struct Node {
    pub identity: Option<Identity>,
    pub target: Point,
    pub material_corner: bool,
    pub constraints: BTreeSet<usize>,
}

fn edge_exact(p: Point, a: Point, b: Point) -> bool {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let x = p.x - a.x;
    let y = p.y - a.y;
    let products = (dx * y).abs() + (dy * x).abs();
    let coordinates = ulp(p.x.abs().max(a.x.abs()).max(b.x.abs())) * dy.abs()
        + ulp(p.y.abs().max(a.y.abs()).max(b.y.abs())) * dx.abs();
    (dx * y - dy * x).abs() <= 16.0 * f64::EPSILON * products + 8.0 * coordinates
}
fn equation(s: &Support) -> Plane {
    match s.kind {
        Kind::Edge { a, b } => Plane {
            a: b.y - a.y,
            b: a.x - b.x,
            c: (b.x - a.x) * a.y - (b.y - a.y) * a.x,
        },
        Kind::Equality { first, second, .. } => first.minus(second),
    }
}
fn on(s: &Support, p: Point) -> bool {
    match s.kind {
        Kind::Edge { a, b } => edge_exact(p, a, b),
        Kind::Equality { first, second, .. } => agreed(&[first, second], p),
    }
}
fn finite(s: &Support, p: Point, budget: f64) -> bool {
    match s.kind {
        Kind::Edge { .. } => s.members.iter().any(|&(a, b)| {
            let len = length(a, b);
            let t = parameter(p, a, b);
            len > 0.0 && t >= -budget / len && t <= 1.0 + budget / len
        }),
        Kind::Equality { .. } => true,
    }
}
fn same_line(a: &Support, b: &Support) -> bool {
    match (&a.kind, &b.kind) {
        (Kind::Edge { a: p, b: q }, _) => on(b, *p) && on(b, *q),
        (_, Kind::Edge { a: p, b: q }) => on(a, *p) && on(a, *q),
        _ => {
            let p = equation(a);
            let q = equation(b);
            let norm = p.a.abs().max(p.b.abs());
            let other = q.a.abs().max(q.b.abs());
            if norm == 0.0 || other == 0.0 {
                return false;
            }
            let sign = if p.a * q.a + p.b * q.b < 0.0 {
                -1.0
            } else {
                1.0
            };
            [p.a / norm, p.b / norm, p.c / norm]
                .into_iter()
                .zip([sign * q.a / other, sign * q.b / other, sign * q.c / other])
                .all(|(x, y)| (x - y).abs() <= 8.0 * ulp(x.abs().max(y.abs())))
        }
    }
}
fn solve(a: &Support, b: &Support) -> Option<Point> {
    if let Kind::Edge { a: origin, b: end } = a.kind {
        let dx = end.x - origin.x;
        let dy = end.y - origin.y;
        let q = equation(b);
        let denominator = q.a * dx + q.b * dy;
        if denominator.abs() <= 64.0 * f64::EPSILON * (q.a * dx).abs().max((q.b * dy).abs()) {
            return None;
        }
        // Solve the same canonical 2x2 system in a local origin. Forming
        // large world-coordinate constants loses the ULP certificate on
        // shallow intersections of two finite material edges.
        let value = match b.kind {
            Kind::Edge { a: p, b: q } => {
                (q.y - p.y) * (origin.x - p.x) - (q.x - p.x) * (origin.y - p.y)
            }
            Kind::Equality { first, second, .. } => first.minus(second).height(origin),
        };
        let t = -value / denominator;
        let target = Point {
            x: origin.x + t * dx,
            y: origin.y + t * dy,
        };
        return (target.x.is_finite() && target.y.is_finite()).then_some(target);
    }
    let p = equation(a);
    let q = equation(b);
    let det = p.a * q.b - p.b * q.a;
    if det.abs() <= 64.0 * f64::EPSILON * (p.a * q.b).abs().max((p.b * q.a).abs()) {
        return None;
    }
    let target = Point {
        x: (p.b * q.c - p.c * q.b) / det,
        y: (p.c * q.a - p.a * q.c) / det,
    };
    (target.x.is_finite() && target.y.is_finite()).then_some(target)
}

impl Authority {
    pub(super) fn provenance(&self, raw: &supports::Supports) -> String {
        raw.segments
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                (s.owner == 7 && s.ring == 0 && (1..=5).contains(&s.edge))
                    || (s.owner == 100 && s.ring == 0 && (7..=12).contains(&s.edge))
            })
            .map(|(i, s)| {
                format!(
                    "{}:{}:{}={:?}",
                    s.owner,
                    s.ring,
                    s.edge,
                    self.segment_ids[i].map(|id| (id, &self.supports[id].name))
                )
            })
            .collect::<Vec<_>>()
            .join(", ")
    }
    pub(super) fn build(raw: &supports::Supports, faces: &[RawFace]) -> Result<Self, String> {
        let mut contours = BTreeMap::<String, Vec<Point>>::new();
        let mut planes = BTreeMap::<PlanKey, Plane>::new();
        for face in faces {
            for contour in face.source.material_contours.iter() {
                if let Some(existing) = contours.insert(contour.id.clone(), contour.points.clone())
                    && existing != contour.points
                {
                    return Err(
                        "Contour matériel Boundary d’un même id avec deux géométries.".into(),
                    );
                }
            }
            let key = (face.source.group.clone(), face.source.plan_id);
            if let Some(existing) = planes.insert(key, face.source.plane)
                && (existing.a != face.source.plane.a
                    || existing.b != face.source.plane.b
                    || existing.c != face.source.plane.c)
            {
                return Err("Plan Boundary d’un même id avec deux coefficients.".into());
            }
            for created in
                face.source.creation_planes.iter().filter(|c| {
                    c.layer == face.source.layer && c.floor_z_m == face.source.floor_z_m
                })
            {
                planes.insert((created.group.clone(), created.id), created.plane);
            }
        }
        let mut supports = Vec::<Support>::new();
        let mut vertices = vec![];
        let mut native_rings = BTreeSet::new();
        for (name, ring) in contours {
            if !native_rings.insert(
                ring.iter()
                    .map(|p| (p.x.to_bits(), p.y.to_bits()))
                    .collect::<Vec<_>>(),
            ) {
                continue;
            }
            let mut ids = vec![];
            for (edge, (&a, &b)) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .enumerate()
            {
                let support = Support {
                    name: format!("E:{name}:{edge}"),
                    kind: Kind::Edge { a, b },
                    members: vec![(a, b)],
                };
                let existing = supports.iter().position(|s| {
                    let Kind::Edge { a: p, b: q } = s.kind else {
                        return false;
                    };
                    let lo = parameter(a, p, q).min(parameter(b, p, q)).max(0.0);
                    let hi = parameter(a, p, q).max(parameter(b, p, q)).min(1.0);
                    hi + 8.0 * ulp(lo.abs().max(hi.abs()).max(1.0)) >= lo
                        && same_line(s, &support)
                        && same_line(&support, s)
                });
                let id = existing.unwrap_or_else(|| {
                    let id = supports.len();
                    supports.push(support);
                    id
                });
                if existing.is_some() {
                    supports[id].members.push((a, b));
                }
                ids.push(id);
            }
            for (i, &point) in ring.iter().enumerate() {
                if !ids.is_empty() && ids[i] != ids[(i + ids.len() - 1) % ids.len()] {
                    vertices.push(Vertex {
                        point,
                        supports: [ids[(i + ids.len() - 1) % ids.len()], ids[i]],
                    });
                }
            }
        }
        let material_count = supports.len();
        let plans: Vec<_> = planes.into_iter().collect();
        for (i, (first_key, first)) in plans.iter().enumerate() {
            for (second_key, second) in &plans[i + 1..] {
                let delta = first.minus(*second);
                if delta.a == 0.0 && delta.b == 0.0 {
                    continue;
                }
                let support = Support {
                    name: format!("L:{first_key:?}:{second_key:?}"),
                    kind: Kind::Equality {
                        first: *first,
                        second: *second,
                        keys: [first_key.clone(), second_key.clone()],
                    },
                    members: vec![],
                };
                // An equality exactly coinciding with a material line is that
                // same support, with every finite member retained below.
                if supports[..material_count]
                    .iter()
                    .any(|s| same_line(s, &support))
                {
                    continue;
                }
                supports.push(support);
            }
        }
        let mut segment_ids = vec![];
        let mut segment_candidates = vec![];
        for segment in &raw.segments {
            let owner = &faces[segment.owner].source;
            let key = (owner.group.clone(), owner.plan_id);
            let candidates: Vec<_> = supports
                .iter()
                .enumerate()
                .filter_map(|(id, s)| {
                    let carried = match &s.kind {
                        Kind::Edge { .. } => s.members.iter().any(|&(a, b)| {
                            [segment.a, segment.b].iter().all(|&p| {
                                let len = length(a, b);
                                let t = parameter(p, a, b);
                                len > 0.0
                                    && distance_to_segment(p, a, b) <= segment.error
                                    && t >= -segment.error / len
                                    && t <= 1.0 + segment.error / len
                            })
                        }),
                        Kind::Equality {
                            first,
                            second,
                            keys,
                        } => {
                            keys.contains(&key)
                                && [segment.a, segment.b].iter().all(|&p| {
                                    let delta = first.minus(*second);
                                    let norm = libm::sqrt(delta.a * delta.a + delta.b * delta.b);
                                    delta.height(p).abs()
                                        <= norm * segment.error
                                            + 8.0
                                                * ulp(first
                                                    .height(p)
                                                    .abs()
                                                    .max(second.height(p).abs()))
                                })
                        }
                    };
                    carried.then_some(id)
                })
                .collect();
            let identity = candidates.first().copied().filter(|&first| {
                candidates
                    .iter()
                    .all(|&other| same_line(&supports[first], &supports[other]))
            });
            segment_ids.push(identity);
            segment_candidates.push(candidates);
        }
        Ok(Self {
            supports,
            vertices,
            segment_ids,
            segment_candidates,
        })
    }
    pub(super) fn node_report(&self, id: usize, raw: &supports::Supports) -> String {
        raw.carriers[id]
            .iter()
            .map(|&i| {
                let s = &raw.segments[i];
                format!(
                    "{}:{}:{} {:?}→{:?} => {:?}",
                    s.owner,
                    s.ring,
                    s.edge,
                    s.a,
                    s.b,
                    self.segment_candidates[i]
                        .iter()
                        .map(|&j| (&self.supports[j].name, &self.supports[j].kind))
                        .collect::<Vec<_>>()
                )
            })
            .collect::<Vec<_>>()
            .join(" ; ")
    }

    pub(super) fn identify(
        &self,
        id: usize,
        p: Point,
        raw: &supports::Supports,
        budget: f64,
    ) -> Result<Node, String> {
        let mut constraints: BTreeSet<_> = raw.carriers[id]
            .iter()
            .filter_map(|&s| self.segment_ids[s])
            .collect();
        // Only nonambiguous finite edges can establish a material corner.
        let mut corner = false;
        let mut vertex = None;
        for v in &self.vertices {
            if length(p, v.point) > budget || constraints.len() < 2 {
                continue;
            }
            if constraints.iter().all(|&s| {
                on(&self.supports[s], v.point) && finite(&self.supports[s], v.point, budget)
            }) && v.supports.iter().any(|s| constraints.contains(s))
            {
                if vertex.is_some_and(|q| q != v.point) {
                    return Err(
                        "Plusieurs vrais coins matériels Boundary dans un même certificat.".into(),
                    );
                }
                vertex = Some(v.point);
                constraints.extend(v.supports);
                corner = true;
            }
        }
        let ids: Vec<_> = constraints.iter().copied().collect();
        let mut pair = None;
        let mut q = p;
        for (i, &a) in ids.iter().enumerate() {
            for &b in &ids[i + 1..] {
                if let Some(target) = solve(&self.supports[a], &self.supports[b]) {
                    pair = Some((a, b));
                    q = vertex.unwrap_or(target);
                    break;
                }
            }
            if pair.is_some() {
                break;
            }
        }
        let identity = if let Some((a, b)) = pair {
            if length(p, q) > budget
                || !constraints
                    .iter()
                    .all(|&s| on(&self.supports[s], q) && finite(&self.supports[s], q, budget))
            {
                return Err(format!(
                    "Concurrence matérielle Boundary hors ULP : nœud{id}, p{p:?}, q{q:?}, déplacement{} borne{budget}, supports {:?}.",
                    length(p, q),
                    ids.iter()
                        .map(|&s| (&self.supports[s].name, &self.supports[s].kind))
                        .collect::<Vec<_>>()
                ));
            }
            Some(Identity::Intersection(a, b))
        } else if ids.len() == 1 {
            if matches!(self.supports[ids[0]].kind, Kind::Edge { .. }) {
                let &(a, b) = self.supports[ids[0]]
                    .members
                    .iter()
                    .min_by(|&&(a, b), &&(c, d)| {
                        distance_to_segment(p, a, b).total_cmp(&distance_to_segment(p, c, d))
                    })
                    .unwrap();
                let t = parameter(p, a, b);
                q = Point {
                    x: a.x + t * (b.x - a.x),
                    y: a.y + t * (b.y - a.y),
                };
                if length(p, q) > budget {
                    return Err("Steiner matériel Boundary hors borne.".into());
                }
            }
            Some(Identity::Steiner(ids[0], q.x.to_bits(), q.y.to_bits()))
        } else {
            None
        };
        Ok(Node {
            identity,
            target: q,
            material_corner: corner,
            constraints,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn triple(offset: f64) -> (Authority, supports::Supports) {
        let x = Support {
            name: "x=0".into(),
            kind: Kind::Edge {
                a: Point { x: 0.0, y: 0.0 },
                b: Point { x: 0.0, y: 48.0 },
            },
            members: vec![(Point { x: 0.0, y: 0.0 }, Point { x: 0.0, y: 48.0 })],
        };
        let y = Support {
            name: "y=48".into(),
            kind: Kind::Edge {
                a: Point { x: 0.0, y: 48.0 },
                b: Point { x: 48.0, y: 48.0 },
            },
            members: vec![(Point { x: 0.0, y: 48.0 }, Point { x: 48.0, y: 48.0 })],
        };
        let ridge = Support {
            name: "x+y=48".into(),
            kind: Kind::Equality {
                first: Plane {
                    a: 0.0,
                    b: 0.0,
                    c: 0.0,
                },
                second: Plane {
                    a: 1.0,
                    b: 1.0,
                    c: -48.0 - offset,
                },
                keys: [("first".into(), 0), ("second".into(), 1)],
            },
            members: vec![],
        };
        let authority = Authority {
            supports: vec![x, y, ridge],
            vertices: vec![Vertex {
                point: Point { x: 0.0, y: 48.0 },
                supports: [0, 1],
            }],
            segment_ids: vec![Some(0), Some(1), Some(2)],
            segment_candidates: vec![vec![0], vec![1], vec![2]],
        };
        let raw = supports::Supports {
            segments: vec![],
            parents: vec![],
            edges: BTreeMap::new(),
            carriers: vec![
                BTreeSet::from([0, 1]),
                BTreeSet::from([1, 2]),
                BTreeSet::from([0, 1, 2]),
                BTreeSet::new(),
            ],
            classes: vec![],
        };
        (authority, raw)
    }
    #[test]
    fn true_triple_uses_one_native_corner_and_identical_bits() {
        let (authority, raw) = triple(0.0);
        let first = authority
            .identify(0, Point { x: -4e-8, y: 48.0 }, &raw, 1e-6)
            .unwrap();
        let second = authority
            .identify(
                1,
                Point {
                    x: -4e-8,
                    y: 48.0 + 4e-8,
                },
                &raw,
                1e-6,
            )
            .unwrap();
        assert_eq!(first.identity, second.identity);
        assert_eq!(first.target, second.target);
        assert_eq!(first.target, Point { x: 0.0, y: 48.0 });
    }
    #[test]
    fn a_quasi_triple_at_ten_nanometers_is_not_a_concurrence() {
        let (authority, raw) = triple(1e-8);
        assert!(
            authority
                .identify(2, Point { x: 0.0, y: 48.0 }, &raw, 1e-6)
                .is_err()
        );
    }
    #[test]
    fn two_native_vertices_ten_nanometers_apart_have_distinct_ids() {
        let (mut authority, mut raw) = triple(0.0);
        let point = Point {
            x: 0.0,
            y: 48.0 + 1e-8,
        };
        authority.supports.push(Support {
            name: "y=48+10nm".into(),
            kind: Kind::Edge {
                a: point,
                b: Point {
                    x: 48.0,
                    y: point.y,
                },
            },
            members: vec![(
                point,
                Point {
                    x: 48.0,
                    y: point.y,
                },
            )],
        });
        authority.vertices.push(Vertex {
            point,
            supports: [0, 3],
        });
        authority.segment_ids.push(Some(3));
        raw.carriers[1] = BTreeSet::from([0, 3]);
        let first = authority
            .identify(0, Point { x: 0.0, y: 48.0 }, &raw, 1e-6)
            .unwrap();
        let second = authority.identify(1, point, &raw, 1e-6).unwrap();
        assert_ne!(first.identity, second.identity);
        assert_ne!(first.target, second.target);
        raw.carriers[2] = BTreeSet::from([0, 1, 3]);
        assert!(authority.identify(2, point, &raw, 1e-6).is_err());
    }
    #[test]
    fn an_unknown_positive_spur_has_no_corner_alias() {
        let (authority, raw) = triple(0.0);
        let point = Point {
            x: 0.6,
            y: 48.0 + 1e-8,
        };
        let unknown = authority.identify(3, point, &raw, 1e-6).unwrap();
        assert!(unknown.identity.is_none());
        assert_eq!(unknown.target, point);
        let path = vec![0, 1, 2, 3];
        assert_eq!(reduce_chain(path.clone()).0, path);
    }
}
