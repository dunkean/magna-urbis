//! Explicit contour triangulation. Geometry remains in its source precision.
use super::*;
use geo::kernels::{Kernel, Orientation, RobustKernel};
#[path = "boundary_junctions.rs"]
mod junctions;
#[path = "boundary_native.rs"]
mod native;

pub(super) fn native_candidates(candidates: &[Candidate]) -> Result<native::NativeResult, String> {
    native::build(candidates)
}

fn orient(a: Point, b: Point, c: Point) -> i8 {
    match RobustKernel::orient2d(
        geo::Coord { x: a.x, y: a.y },
        geo::Coord { x: b.x, y: b.y },
        geo::Coord { x: c.x, y: c.y },
    ) {
        Orientation::CounterClockwise => 1,
        Orientation::Clockwise => -1,
        Orientation::Collinear => 0,
    }
}
fn length(a: Point, b: Point) -> f64 {
    libm::hypot(b.x - a.x, b.y - a.y)
}
fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let den = dx * dx + dy * dy;
    if den == 0.0 {
        return length(p, a);
    }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / den).clamp(0.0, 1.0);
    libm::hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
fn ulp(z: f64) -> f64 {
    let z = z.abs();
    f64::from_bits(z.to_bits() + 1) - z
}
fn rings(s: &Surface) -> impl Iterator<Item = &Vec<Point>> {
    s.iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
}
/// i_float's adapter uses 29-log2(max half extent) integer fractional bits.
/// This is an error bound, never a coordinate grid applied to roof vertices.
fn adapter_bound(a: &Surface, b: &Surface) -> f64 {
    let [x0, y0, x1, y1] = bounds(a);
    let [u0, v0, u1, v1] = bounds(b);
    let extent = ((x1.max(u1) - x0.min(u0)).max(y1.max(v1) - y0.min(v0)) * 0.5).max(1e-12);
    let exponent = libm::log2(extent) as i32;
    2.0 * libm::sqrt(2.0) * libm::exp2((exponent - 29) as f64)
}
pub(super) fn overlay_error(a: &Surface, b: &Surface, out: &Surface) -> f64 {
    if out.is_empty() {
        return 0.0;
    }
    let segments: Vec<_> = rings(a)
        .chain(rings(b))
        .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
        .collect();
    let observed = rings(out)
        .flatten()
        .map(|p| {
            segments
                .iter()
                .map(|(a, b)| distance_to_segment(*p, **a, **b))
                .fold(f64::INFINITY, f64::min)
        })
        .fold(0.0, f64::max);
    observed.max(adapter_bound(a, b))
}
pub(super) fn half_error(a: &Surface, plane: Plane, out: &Surface) -> f64 {
    if out.is_empty() {
        return 0.0;
    }
    let den = libm::hypot(plane.a, plane.b);
    let observed = rings(out)
        .flatten()
        .map(|p| {
            let edge = rings(a)
                .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
                .map(|(a, b)| distance_to_segment(*p, *a, *b))
                .fold(f64::INFINITY, f64::min);
            edge.min(if den > 0.0 {
                plane.height(*p).abs() / den
            } else {
                0.0
            })
        })
        .fold(0.0, f64::max);
    // half_plane's finite clipping box extends the input by one full extent.
    observed.max(4.0 * adapter_bound(a, a))
}

#[derive(Clone)]
struct Ring {
    points: Vec<usize>,
    face: usize,
    hole: bool,
}
#[derive(Clone, Copy)]
struct Edge {
    a: usize,
    b: usize,
    ring: usize,
}
struct Pool {
    points: Vec<Point>,
    parents: Vec<usize>,
    owners: Vec<usize>,
    rings: Vec<BTreeSet<usize>>,
    sources: Vec<usize>,
    members: Vec<Vec<usize>>,
}
impl Pool {
    fn root(&self, mut i: usize) -> usize {
        while self.parents[i] != i {
            i = self.parents[i];
        }
        i
    }
    fn add(&mut self, p: Point, face: usize, ring: usize) -> usize {
        let i = self.points.len();
        self.points.push(p);
        self.parents.push(i);
        self.owners.push(face);
        self.rings.push(BTreeSet::from([ring]));
        self.sources.push(face);
        self.members.push(vec![i]);
        i
    }
    fn join(&mut self, a: usize, b: usize, raw: &[RawFace]) -> bool {
        let (a, b) = (self.root(a), self.root(b));
        if a == b {
            return true;
        }
        if !self.rings[a].is_disjoint(&self.rings[b]) {
            return false;
        }
        let less = |a: usize, b: usize| {
            self.points[a]
                .x
                .total_cmp(&self.points[b].x)
                .then(self.points[a].y.total_cmp(&self.points[b].y))
                .then(a.cmp(&b))
                .is_lt()
        };
        let (keep, other) = if less(a, b) { (a, b) } else { (b, a) };
        let key = |i: usize| (&raw[i].source.layer, &raw[i].source.group, i);
        let owner = if key(self.owners[other]) < key(self.owners[keep]) {
            self.owners[other]
        } else {
            self.owners[keep]
        };
        for &member in self.members[keep].iter().chain(&self.members[other]) {
            let source = &raw[self.sources[member]].source;
            let authority = &raw[owner].source;
            let p = self.points[keep];
            let error = source.overlay_error_m
                + authority.overlay_error_m
                + 16.0 * ulp(p.x.abs().max(p.y.abs()));
            if length(self.points[member], p) > error || !height_match(source, authority, p, error)
            {
                return false;
            }
        }
        self.parents[other] = keep;
        let moved = self.rings[other].clone();
        self.rings[keep].extend(moved);
        let moved = std::mem::take(&mut self.members[other]);
        self.members[keep].extend(moved);
        self.owners[keep] = owner;
        true
    }
    fn vertex(&self, id: usize, raw: &[RawFace]) -> Vertex3 {
        let id = self.root(id);
        let p = self.points[id];
        let owner = self.owners[id];
        Vertex3 {
            x: p.x,
            y: p.y,
            z: raw[owner].source.plane.height(p),
        }
    }
}
fn compatible(a: &Candidate, b: &Candidate) -> bool {
    a.layer == b.layer && !a.corbel && !b.corbel
}
fn height_match(a: &Candidate, b: &Candidate, p: Point, epsilon: f64) -> bool {
    let za = a.plane.height(p);
    let zb = b.plane.height(p);
    (za - zb).abs()
        <= libm::hypot(a.plane.a - b.plane.a, a.plane.b - b.plane.b) * epsilon
            + 8.0 * ulp(za.abs().max(zb.abs()))
}
fn parameter(p: Point, a: Point, b: Point) -> f64 {
    ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y))
        / ((b.x - a.x).powi(2) + (b.y - a.y).powi(2))
}
fn line_distance(p: Point, a: Point, b: Point) -> f64 {
    if orient(a, b, p) == 0 {
        return 0.0;
    }
    ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)).abs() / length(a, b)
}
fn overlaps_opposite(a: Point, b: Point, c: Point, d: Point, epsilon: f64) -> bool {
    let l = length(a, b);
    let m = length(c, d);
    if l == 0.0 || m == 0.0 || (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) >= 0.0 {
        return false;
    }
    if line_distance(c, a, b) > epsilon
        || line_distance(d, a, b) > epsilon
        || line_distance(a, c, d) > epsilon
        || line_distance(b, c, d) > epsilon
    {
        return false;
    }
    let (u, v) = (parameter(c, a, b), parameter(d, a, b));
    (u.max(v).min(1.0) - u.min(v).max(0.0)) * l > epsilon
}
fn proper_intersection(a: Point, b: Point, c: Point, d: Point) -> bool {
    let [u, v, w, x] = [
        orient(a, b, c),
        orient(a, b, d),
        orient(c, d, a),
        orient(c, d, b),
    ];
    u * v < 0 && w * x < 0
}
fn on_segment(p: Point, a: Point, b: Point) -> bool {
    orient(a, b, p) == 0
        && p.x >= a.x.min(b.x)
        && p.x <= a.x.max(b.x)
        && p.y >= a.y.min(b.y)
        && p.y <= a.y.max(b.y)
}
fn simple(ids: &[usize], pool: &Pool) -> bool {
    for i in 0..ids.len() {
        let a = pool.points[pool.root(ids[i])];
        let b = pool.points[pool.root(ids[(i + 1) % ids.len()])];
        if a == b {
            return false;
        }
        for j in i + 1..ids.len() {
            if j == i + 1 || (i == 0 && j + 1 == ids.len()) {
                continue;
            }
            let c = pool.points[pool.root(ids[j])];
            let d = pool.points[pool.root(ids[(j + 1) % ids.len()])];
            if proper_intersection(a, b, c, d) {
                return false;
            }
            if on_segment(c, a, b) || on_segment(d, a, b) {
                return false;
            }
        }
    }
    true
}
fn area_ring(ids: &[usize], pool: &Pool) -> f64 {
    let origin = pool.points[pool.root(ids[0])];
    let mut sum = 0.0;
    let mut correction = 0.0;
    for (&a, &b) in ids.iter().zip(ids.iter().cycle().skip(1)).take(ids.len()) {
        let a = pool.points[pool.root(a)];
        let b = pool.points[pool.root(b)];
        let term = (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
        let y = term - correction;
        let next = sum + y;
        correction = (next - sum) - y;
        sum = next;
    }
    sum * 0.5
}
type BridgeResult = (Vec<usize>, BTreeSet<(usize, usize)>);
fn bridge(
    mut outer: Vec<usize>,
    holes: &[Vec<usize>],
    pool: &Pool,
) -> Result<BridgeResult, String> {
    let mut bridges = BTreeSet::new();
    let domain = vec![Polygon {
        outer: outer.iter().map(|&i| pool.points[pool.root(i)]).collect(),
        holes: holes
            .iter()
            .map(|h| h.iter().map(|&i| pool.points[pool.root(i)]).collect())
            .collect(),
    }];
    for hole in holes {
        if let Some((target, start)) = outer.iter().enumerate().find_map(|(target, &corner)| {
            hole.iter()
                .position(|&point| pool.root(point) == pool.root(corner))
                .map(|start| (target, start))
        }) {
            // An OGC hole may touch its outer contour at a graph node. Join
            // the two occurrences there; a second artificial cut would create
            // overlapping excursions around that already shared corner.
            let mut joined = outer[..=target].to_vec();
            joined.extend((1..hole.len()).map(|i| hole[(start + i) % hole.len()]));
            joined.push(hole[start]);
            joined.extend_from_slice(&outer[target + 1..]);
            outer = joined;
            continue;
        }
        let start = (0..hole.len())
            .max_by(|&a, &b| {
                let a = pool.points[pool.root(hole[a])];
                let b = pool.points[pool.root(hole[b])];
                a.x.total_cmp(&b.x).then(b.y.total_cmp(&a.y))
            })
            .unwrap();
        let p = pool.points[pool.root(hole[start])];
        let mut choices: Vec<_> = (0..outer.len()).collect();
        choices.sort_by(|&a, &b| {
            length(p, pool.points[pool.root(outer[a])])
                .total_cmp(&length(p, pool.points[pool.root(outer[b])]))
                .then(a.cmp(&b))
        });
        let target = choices
            .into_iter()
            .find(|&index| {
                let q = pool.points[pool.root(outer[index])];
                if p == q {
                    return false;
                }
                let pieces = corbel::line_intervals(p, q, &domain);
                if pieces.is_empty()
                    || pieces[0].0 > 1e-9
                    || pieces.last().unwrap().1 < 1.0 - 1e-9
                    || pieces.windows(2).any(|w| w[1].0 - w[0].1 > 1e-9)
                {
                    return false;
                }
                !outer
                    .iter()
                    .zip(outer.iter().cycle().skip(1))
                    .take(outer.len())
                    .any(|(&a, &b)| {
                        proper_intersection(
                            p,
                            q,
                            pool.points[pool.root(a)],
                            pool.points[pool.root(b)],
                        )
                    })
            })
            .ok_or("Trou de toiture sans pont intérieur visible.")?;
        let mut joined = outer[..=target].to_vec();
        let a = pool.root(hole[start]);
        let b = pool.root(outer[target]);
        bridges.insert((a.min(b), a.max(b)));
        joined.extend((0..hole.len()).map(|i| hole[(start + i) % hole.len()]));
        joined.push(hole[start]);
        joined.push(outer[target]);
        joined.extend_from_slice(&outer[target + 1..]);
        outer = joined;
    }
    Ok((outer, bridges))
}
fn ears(
    ids: &[usize],
    pool: &Pool,
    masks: &BTreeMap<usize, BTreeSet<usize>>,
    raw: &[RawFace],
    normal: [f64; 3],
) -> Result<Vec<[usize; 3]>, String> {
    let mut remaining: Vec<_> = (0..ids.len()).collect();
    let mut out = Vec::with_capacity(ids.len().saturating_sub(2));
    let point = |i: usize| pool.points[pool.root(ids[i])];
    let same_edge = |tri: [usize; 3]| {
        masks[&pool.root(ids[tri[0]])].iter().any(|edge| {
            masks[&pool.root(ids[tri[1]])].contains(edge)
                && masks[&pool.root(ids[tri[2]])].contains(edge)
        })
    };
    let positive = |tri: [usize; 3]| {
        if same_edge(tri) || orient(point(tri[0]), point(tri[1]), point(tri[2])) <= 0 {
            return false;
        }
        let [a, b, c] = tri.map(|i| pool.vertex(ids[i], raw));
        let u = [b.x - a.x, b.y - a.y, b.z - a.z];
        let v = [c.x - a.x, c.y - a.y, c.z - a.z];
        let cross = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        cross.iter().zip(normal).map(|(a, b)| a * b).sum::<f64>() > 0.0
    };
    while remaining.len() > 3 {
        let ear = (0..remaining.len()).find_map(|i| {
            let tri = [
                remaining[(i + remaining.len() - 1) % remaining.len()],
                remaining[i],
                remaining[(i + 1) % remaining.len()],
            ];
            let [a, b, c] = tri.map(point);
            if !positive(tri) {
                return None;
            }
            if remaining
                .iter()
                .zip(remaining.iter().cycle().skip(1))
                .take(remaining.len())
                .any(|(&u, &v)| proper_intersection(a, c, point(u), point(v)))
            {
                return None;
            }
            if remaining.iter().any(|&j| {
                !tri.contains(&j)
                    && !tri.iter().any(|&k| pool.root(ids[k]) == pool.root(ids[j]))
                    && orient(a, b, point(j)) >= 0
                    && orient(b, c, point(j)) >= 0
                    && orient(c, a, point(j)) >= 0
            }) {
                return None;
            }
            if remaining.len() == 4 {
                let tail: Vec<_> = remaining
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, j)| *j)
                    .collect();
                if !positive([tail[0], tail[1], tail[2]]) {
                    return None;
                }
            }
            Some((i, tri))
        });
        let Some((index, tri)) = ear else {
            let mut balance = BTreeMap::<(usize, usize), (usize, i32)>::new();
            for (&a, &b) in remaining
                .iter()
                .zip(remaining.iter().cycle().skip(1))
                .take(remaining.len())
            {
                let a = pool.root(ids[a]);
                let b = pool.root(ids[b]);
                let key = (a.min(b), a.max(b));
                let entry = balance.entry(key).or_default();
                entry.0 += 1;
                entry.1 += if a < b { 1 } else { -1 };
            }
            if !balance.is_empty() && balance.values().all(|&v| v == (2, 0)) {
                // An exactly null directed chain encloses no remaining facet.
                // The caller still certifies every material original boundary.
                remaining.clear();
                break;
            }
            return Err(format!(
                "Anneau Boundary sans oreille positive exportable : {} sommets, xy {:.12},{:.12}, points {:?}, masques {:?}.",
                remaining.len(),
                point(remaining[0]).x,
                point(remaining[0]).y,
                remaining.iter().map(|&i| point(i)).collect::<Vec<_>>(),
                remaining
                    .iter()
                    .map(|&i| masks[&pool.root(ids[i])].clone())
                    .collect::<Vec<_>>()
            ));
        };
        out.push(tri.map(|i| pool.root(ids[i])));
        remaining.remove(index);
        // Coincident bridge occurrences have no material triangle between them.
        let duplicate = (0..remaining.len()).find(|&i| {
            pool.root(ids[remaining[i]]) == pool.root(ids[remaining[(i + 1) % remaining.len()]])
        });
        if let Some(i) = duplicate {
            remaining.remove(i);
        }
    }
    if remaining.len() == 3 {
        let tri = [remaining[0], remaining[1], remaining[2]];
        if !positive(tri) {
            return Err("Dernière oreille Boundary non positive.".into());
        }
        out.push(tri.map(|i| pool.root(ids[i])));
    }
    Ok(out)
}

/// The height-field pool is fixed before this pass. A volume can attach to it
/// only along a real overlapping contour edge, within the reviewed legacy
/// adapter tolerances. Internal triangulation diagonals are never candidates.
struct BoundaryContours<'a> {
    precise: &'a [RawFace],
    pool: &'a Pool,
    expanded: &'a [Vec<usize>],
    contours: &'a [Ring],
    vertices: &'a BTreeMap<usize, u32>,
}
fn append_volumes(
    mesh: &mut RoofMesh,
    planes: &mut Vec<Option<Plane>>,
    legacy: Vec<RawFace>,
    context: BoundaryContours<'_>,
) -> Result<(), String> {
    let BoundaryContours {
        precise,
        pool,
        expanded,
        contours,
        vertices,
    } = context;
    let layers: BTreeMap<_, _> = legacy
        .iter()
        .map(|f| (f.source.group.clone(), f.source.layer.clone()))
        .collect();
    let (other, other_planes) = super::assemble_mesh_legacy(legacy)?;
    let boundary: Vec<_> = expanded
        .iter()
        .enumerate()
        .flat_map(|(ring, ids)| {
            ids.iter()
                .zip(ids.iter().cycle().skip(1))
                .take(ids.len())
                .map(move |(&a, &b)| (a, b, contours[ring].face))
        })
        .collect();
    let mut contacts: Vec<Option<u32>> = vec![None; other.vertices.len()];
    let mut edge_points: BTreeMap<(u32, u32), Vec<(f64, u32)>> = BTreeMap::new();
    let mut xy: BTreeMap<(i64, i64), Point> = BTreeMap::new();
    for face in &other.faces {
        for (&i, &j) in face
            .vertices
            .iter()
            .zip(face.vertices.iter().cycle().skip(1))
            .take(face.vertices.len())
        {
            let a = &other.vertices[i as usize];
            let b = &other.vertices[j as usize];
            let pa = Point { x: a.x, y: a.y };
            let pb = Point { x: b.x, y: b.y };
            if pa == pb {
                continue;
            }
            for &(u, v, source) in &boundary {
                if layers
                    .get(&face.roof_group)
                    .is_none_or(|layer| layer != &precise[source].source.layer)
                {
                    continue;
                }
                let c = pool.points[u];
                let d = pool.points[v];
                let error = 0.0005 + precise[source].source.overlay_error_m;
                // Volume orientation may be vertical; certification still
                // requires reciprocal collinearity and finite overlap.
                if line_distance(c, pa, pb) > error
                    || line_distance(d, pa, pb) > error
                    || line_distance(pa, c, d) > error
                    || line_distance(pb, c, d) > error
                {
                    continue;
                }
                let (x, y) = (parameter(c, pa, pb), parameter(d, pa, pb));
                if (x.max(y).min(1.0) - x.min(y).max(0.0)) * length(pa, pb) <= error {
                    continue;
                }
                for root in [u, v] {
                    let value = pool.vertex(root, precise);
                    let t = parameter(
                        Point {
                            x: value.x,
                            y: value.y,
                        },
                        pa,
                        pb,
                    );
                    if (value.z - (a.z + t * (b.z - a.z))).abs() > 0.001 + 8.0 * ulp(value.z) {
                        continue;
                    }
                    let Some(&id) = vertices.get(&root) else {
                        return Err("Jonction Boundary non utilisée par ses triangles.".into());
                    };
                    for (old, p) in [(i, pa), (j, pb)] {
                        if length(
                            p,
                            Point {
                                x: value.x,
                                y: value.y,
                            },
                        ) <= error
                            && (other.vertices[old as usize].z - value.z).abs()
                                <= 0.001 + 8.0 * ulp(value.z)
                        {
                            let replace = contacts[old as usize].is_none_or(|previous| {
                                let q = &mesh.vertices[previous as usize];
                                length(
                                    p,
                                    Point {
                                        x: value.x,
                                        y: value.y,
                                    },
                                ) < length(p, Point { x: q.x, y: q.y })
                            });
                            if replace {
                                contacts[old as usize] = Some(id);
                                let key = vertex_key(&other.vertices[old as usize]);
                                xy.insert(
                                    (key.0, key.1),
                                    Point {
                                        x: value.x,
                                        y: value.y,
                                    },
                                );
                            }
                        }
                    }
                    if t > 0.0 && t < 1.0 {
                        edge_points.entry((i, j)).or_default().push((t, id));
                    }
                }
            }
        }
    }
    let mut remap = vec![];
    for (i, mut value) in other.vertices.into_iter().enumerate() {
        if let Some(id) = contacts[i] {
            remap.push(id);
            continue;
        }
        let key = vertex_key(&value);
        if let Some(p) = xy.get(&(key.0, key.1)) {
            value.x = p.x;
            value.y = p.y;
        }
        let id = mesh.vertices.len() as u32;
        mesh.vertices.push(value);
        remap.push(id);
    }
    for (mut face, plane) in other.faces.into_iter().zip(other_planes) {
        if mesh.faces.len() == MAX_ROOF_FACES {
            return Err("Budget toitures réel : 20001 > 20000 faces.".into());
        }
        let mut ids = vec![];
        for (&a, &b) in face
            .vertices
            .iter()
            .zip(face.vertices.iter().cycle().skip(1))
            .take(face.vertices.len())
        {
            ids.push(remap[a as usize]);
            if let Some(points) = edge_points.get_mut(&(a, b)) {
                points.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
                ids.extend(
                    points
                        .iter()
                        .filter(|(_, id)| *id != remap[a as usize] && *id != remap[b as usize])
                        .map(|(_, id)| *id),
                );
            }
        }
        ids.dedup();
        if ids.first() == ids.last() {
            ids.pop();
        }
        let coordinates: Vec<_> = ids
            .iter()
            .map(|&id| mesh.vertices[id as usize].clone())
            .collect();
        let Some(n) = normal(&coordinates) else {
            return Err(format!(
                "Face verticale Boundary dégénérée : {}.",
                face.roof_group
            ));
        };
        if n.iter().zip(face.normal).map(|(a, b)| a * b).sum::<f64>() <= 0.0 {
            return Err("Orientation du raccord vertical Boundary inversée.".into());
        }
        let origin = &coordinates[0];
        if coordinates.iter().any(|p| {
            ((p.x - origin.x) * n[0] + (p.y - origin.y) * n[1] + (p.z - origin.z) * n[2]).abs()
                > 0.001
        }) {
            return Err("Raccord vertical Boundary non planaire.".into());
        }
        face.vertices = ids;
        face.normal = n;
        mesh.faces.push(face);
        planes.push(plane);
    }
    Ok(())
}

type BuildResult = (RoofMesh, Vec<Option<Plane>>);

/// One labelled arrangement is the reviewed fallback when separate boolean
/// adapters cannot identify a junction while preserving every ring's topology.
fn arrangement(raw: Vec<RawFace>) -> Result<(Vec<RawFace>, Vec<String>), String> {
    use geo::{Contains, InteriorPoint};
    use i_overlay::core::{fill_rule::FillRule, overlay::IntOverlayOptions};
    use i_overlay::i_float::adapter::FloatPointAdapter;
    use i_overlay::string::{overlay::StringOverlay, rule::StringRule};
    // Covers above different occupied floors coexist in projection. They are
    // separate physical layers even if the envelope mask names both "main".
    let mut layers: BTreeMap<(String, u64), Vec<RawFace>> = BTreeMap::new();
    let mut out = vec![];
    let mut notes = vec![];
    for face in raw {
        if face.source.boundary_triangulation
            && !face.source.corbel
            && matches!(
                face.source.kind,
                RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
            )
        {
            layers
                .entry((face.source.layer.clone(), face.source.floor_z_m.to_bits()))
                .or_default()
                .push(face);
        } else {
            out.push(face);
        }
    }
    for ((name, floor), faces) in layers {
        let layer = format!("{name} (plancher {:.6}m)", f64::from_bits(floor));
        let domains: Vec<_> = faces
            .iter()
            .map(|face| {
                if face.source.whole_boundary {
                    face.source.domain.clone()
                } else {
                    vec![Polygon {
                        outer: face
                            .vertices
                            .iter()
                            .map(|v| Point { x: v.x, y: v.y })
                            .collect(),
                        holes: vec![],
                    }]
                }
            })
            .collect();
        let all: Surface = domains.iter().flatten().cloned().collect();
        let paths: Vec<Vec<[f64; 2]>> = rings(&all)
            .map(|ring| ring.iter().map(|p| [p.x, p.y]).collect())
            .collect();
        let adapter = FloatPointAdapter::<[f64; 2], f64>::with_iter(paths.iter().flatten());
        let options = IntOverlayOptions {
            preserve_input_collinear: true,
            preserve_output_collinear: true,
            min_output_area: 0,
            ogc: true,
            ..Default::default()
        };
        let mut overlay =
            StringOverlay::with_options(paths.iter().map(Vec::len).sum::<usize>() * 2, options);
        for path in &paths {
            let points: Vec<_> = path.iter().map(|p| adapter.float_to_int(p)).collect();
            overlay.add_shape_contour(&points);
            overlay.add_string_contour(&points);
        }
        let Some(graph) = overlay.build_graph_view(FillRule::NonZero) else {
            return Err("Arrangement Boundary sans domaine rempli.".into());
        };
        let shapes = graph.extract_shapes_custom(StringRule::Slice, options);
        let cells: Surface = shapes
            .into_iter()
            .map(|shape| {
                let mut paths = shape.into_iter().map(|ring| {
                    ring.into_iter()
                        .map(|p| {
                            let p = adapter.int_to_float(&p);
                            Point { x: p[0], y: p[1] }
                        })
                        .collect()
                });
                Polygon {
                    outer: paths.next().unwrap(),
                    holes: paths.collect(),
                }
            })
            .collect();
        let error = overlay_error(&all, &all, &cells);
        let perimeter = rings(&all)
            .map(|r| {
                r.iter()
                    .zip(r.iter().cycle().skip(1))
                    .take(r.len())
                    .map(|(a, b)| length(*a, *b))
                    .sum::<f64>()
            })
            .sum::<f64>();
        let before = area(&all);
        let after = area(&cells);
        let delta = (after - before).abs();
        let bound =
            2.0 * perimeter * error + PI * error * error * paths.len() as f64 + 128.0 * ulp(before);
        if delta > bound {
            return Err(format!(
                "Arrangement Boundary hors borne d'aire : {layer}, delta {delta:.12} > {bound:.12}."
            ));
        }
        let geometries: Vec<_> = domains.iter().map(g::to_geo).collect();
        let mut owners = Vec::with_capacity(cells.len());
        for polygon in &cells {
            let surface = vec![polygon.clone()];
            let geometry = g::to_geo(&surface);
            let Some(sample) = geometry.interior_point() else {
                return Err("Cellule Boundary sans point intérieur.".into());
            };
            let p = Point {
                x: sample.x(),
                y: sample.y(),
            };
            let mut choices: Vec<_> = geometries
                .iter()
                .enumerate()
                .filter(|(_, g)| g.contains(&sample))
                .map(|(i, _)| i)
                .collect();
            if choices.is_empty() {
                choices = domains
                    .iter()
                    .enumerate()
                    .filter(|(_, s)| {
                        rings(s).any(|r| {
                            r.iter()
                                .zip(r.iter().cycle().skip(1))
                                .take(r.len())
                                .any(|(a, b)| distance_to_segment(p, *a, *b) <= error)
                        })
                    })
                    .map(|(i, _)| i)
                    .collect();
            }
            let Some(owner) = choices.into_iter().max_by(|&a, &b| {
                faces[a]
                    .source
                    .plane
                    .height(p)
                    .total_cmp(&faces[b].source.plane.height(p))
                    .then(b.cmp(&a))
            }) else {
                return Err(format!(
                    "Cellule Boundary sans label source : {layer}, xy {:.12},{:.12}.",
                    p.x, p.y
                ));
            };
            owners.push(owner);
        }
        let relocated = junctions::relocate(cells, owners, &faces, &domains, error)?;
        let error = error + relocated.displacement;
        let delta = (area(&relocated.cells) - before).abs();
        let bound =
            2.0 * perimeter * error + PI * error * error * paths.len() as f64 + 128.0 * ulp(before);
        if delta > bound {
            return Err(format!(
                "Jonctions Boundary hors borne d'aire : {layer}, delta {delta:.12} > {bound:.12}."
            ));
        }
        for (polygon, owner) in relocated.cells.into_iter().zip(relocated.owners) {
            let mut source = faces[owner].source.clone();
            source.domain = vec![polygon.clone()];
            source.whole_boundary = true;
            source.overlay_error_m += error;
            let vertices = polygon
                .outer
                .iter()
                .map(|&p| Vertex3 {
                    x: p.x,
                    y: p.y,
                    z: source.plane.height(p),
                })
                .collect();
            out.push(RawFace { vertices, source });
        }
        notes.push(format!("roof: arrangement Boundary couche {layer}, erreur mesurée {error:.12} m, aire avant {before:.9} m², delta {delta:.12} m² (borne {bound:.12}), {} nœuds relocalisés (max {:.12}m), {} chaînes/cellules nulles (écart d’aire initiale {:.12}m²).",relocated.moved,relocated.displacement,relocated.collapsed,relocated.collapsed_area));
    }
    Ok((out, notes))
}

pub(super) fn build(raw: Vec<RawFace>) -> Result<RoofAssembly, String> {
    if raw.iter().any(|f| f.source.native_domain.is_some()) {
        // These rings already belong to the common native support graph.
        // No integer overlay or independent junction restoration is allowed.
        let (mesh, planes) = build_contours(raw, true)?;
        return Ok((mesh, planes, vec![]));
    }
    match build_contours(raw.clone(), false) {
        Ok((mesh, planes)) => Ok((mesh, planes, vec![])),
        Err(error)
            if error.starts_with("Anneau Boundary exporté non simple")
                || error.starts_with("Orientation d'anneau Boundary exporté invalide") =>
        {
            let (arranged, notes) = arrangement(raw)?;
            let (mesh, planes) = build_contours(arranged, true)?;
            Ok((mesh, planes, notes))
        }
        Err(error) => Err(error),
    }
}

fn build_contours(raw: Vec<RawFace>, shared_arrangement: bool) -> Result<BuildResult, String> {
    let (precise, mut legacy): (Vec<_>, Vec<_>) = raw.into_iter().partition(|f| {
        f.source.boundary_triangulation
            && !f.source.corbel
            && matches!(
                f.source.kind,
                RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
            )
    });
    let mut pool = Pool {
        points: vec![],
        parents: vec![],
        owners: vec![],
        rings: vec![],
        sources: vec![],
        members: vec![],
    };
    let mut contours = vec![];
    let mut face_rings = vec![vec![]; precise.len()];
    for (face, raw) in precise.iter().enumerate() {
        let polygon = if raw.source.whole_boundary {
            raw.source.domain[0].clone()
        } else {
            Polygon {
                outer: raw
                    .vertices
                    .iter()
                    .map(|v| Point { x: v.x, y: v.y })
                    .collect(),
                holes: vec![],
            }
        };
        for (hole, ring) in
            std::iter::once((false, &polygon.outer)).chain(polygon.holes.iter().map(|r| (true, r)))
        {
            let id = contours.len();
            let points = ring.iter().map(|&p| pool.add(p, face, id)).collect();
            contours.push(Ring { points, face, hole });
            face_rings[face].push(id);
        }
    }
    let edges: Vec<_> = contours
        .iter()
        .enumerate()
        .flat_map(|(ring, r)| {
            r.points
                .iter()
                .zip(r.points.iter().cycle().skip(1))
                .take(r.points.len())
                .map(move |(&a, &b)| Edge { a, b, ring })
        })
        .collect();
    let original_owners = pool.owners.clone();
    if shared_arrangement {
        // Exact positions from the single arrangement carry its graph-node
        // certificate. Several neighbours may use the same T occurrence.
        let mut nodes: BTreeMap<(u64, u64), Vec<usize>> = BTreeMap::new();
        for i in 0..pool.points.len() {
            let p = pool.points[i];
            let key = (p.x.to_bits(), p.y.to_bits());
            let own = &precise[original_owners[i]].source;
            for &j in nodes.entry(key).or_default().iter() {
                let other = &precise[original_owners[j]].source;
                if compatible(own, other)
                    && height_match(own, other, p, own.overlay_error_m + other.overlay_error_m)
                {
                    pool.join(i, j, &precise);
                }
            }
            nodes.get_mut(&key).unwrap().push(i);
        }
    }
    let mut order: Vec<_> = (0..edges.len()).collect();
    order.sort_by(|&a, &b| {
        pool.points[edges[a].a]
            .x
            .min(pool.points[edges[a].b].x)
            .total_cmp(&pool.points[edges[b].a].x.min(pool.points[edges[b].b].x))
            .then(a.cmp(&b))
    });
    let max_error = precise
        .iter()
        .map(|r| r.source.overlay_error_m)
        .fold(0.0, f64::max);
    let world_ulp = pool
        .points
        .iter()
        .map(|p| ulp(p.x.abs().max(p.y.abs())))
        .fold(0.0, f64::max);
    let search_error = 2.0 * max_error + 16.0 * world_ulp;
    let mut insertions = vec![BTreeSet::new(); edges.len()];
    for (position, &i) in order.iter().enumerate() {
        let e = edges[i];
        let a = pool.points[e.a];
        let b = pool.points[e.b];
        let source = &precise[contours[e.ring].face].source;
        for &j in &order[position + 1..] {
            let f = edges[j];
            let c = pool.points[f.a];
            let d = pool.points[f.b];
            if c.x.min(d.x) > a.x.max(b.x) + search_error {
                break;
            }
            if e.ring == f.ring
                || c.y.min(d.y) > a.y.max(b.y) + search_error
                || c.y.max(d.y) < a.y.min(b.y) - search_error
            {
                continue;
            }
            let other = &precise[contours[f.ring].face].source;
            if !compatible(source, other) {
                continue;
            }
            let epsilon =
                if shared_arrangement && source.floor_z_m.to_bits() == other.floor_z_m.to_bits() {
                    0.0
                } else {
                    (source.overlay_error_m + other.overlay_error_m)
                        .max(16.0 * ulp(a.x.abs().max(a.y.abs()).max(c.x.abs()).max(c.y.abs())))
                };
            if !overlaps_opposite(a, b, c, d, epsilon) {
                continue;
            }
            for (one, two) in [(e.a, f.a), (e.a, f.b), (e.b, f.a), (e.b, f.b)] {
                let p = pool.points[one];
                let q = pool.points[two];
                if length(p, q) <= epsilon
                    && distance_to_segment(p, c, d) <= epsilon
                    && distance_to_segment(q, a, b) <= epsilon
                    && height_match(source, other, p, epsilon)
                {
                    pool.join(one, two, &precise);
                }
            }
            for (edge, ends, from, to) in [
                (i, [f.a, f.b], source, other),
                (j, [e.a, e.b], other, source),
            ] {
                let own = edges[edge];
                let x = pool.points[own.a];
                let y = pool.points[own.b];
                for p in ends {
                    let q = pool.points[p];
                    let t = parameter(q, x, y);
                    if t > 0.0 && t < 1.0 && height_match(from, to, q, epsilon) {
                        insertions[edge].insert(p);
                    }
                }
            }
        }
    }
    // A chain of local contacts may not extend the height certificate of the
    // final representative. Test every original occurrence against that point.
    for i in 0..pool.points.len() {
        let root = pool.root(i);
        let owner = &precise[pool.owners[root]].source;
        let source = &precise[original_owners[i]].source;
        let error = source.overlay_error_m + owner.overlay_error_m + 16.0 * world_ulp;
        if !height_match(source, owner, pool.points[root], error) {
            return Err(format!(
                "Classe de jonction Boundary hors borne de cote : {}.",
                source.group
            ));
        }
    }
    let mut expanded = vec![vec![]; contours.len()];
    let mut masks = vec![BTreeMap::<usize, BTreeSet<usize>>::new(); precise.len()];
    for (index, edge) in edges.iter().enumerate() {
        let a = pool.root(edge.a);
        let b = pool.root(edge.b);
        expanded[edge.ring].push(a);
        let own = &mut masks[contours[edge.ring].face];
        own.entry(a).or_default().insert(index);
        own.entry(b).or_default().insert(index);
        let own_source = &precise[contours[edge.ring].face].source;
        let mut points: Vec<_> = insertions[index]
            .iter()
            .map(|&p| pool.root(p))
            // An identified neighbour corner remains an original corner of
            // this ring, even when it lies within overlay error of another
            // edge. Inserting it twice would fold a positive sliver.
            .filter(|&p| {
                let authority = &precise[pool.owners[p]].source;
                p != a
                    && p != b
                    && pool.points[p] != pool.points[a]
                    && pool.points[p] != pool.points[b]
                    && !pool.rings[p].contains(&edge.ring)
                    && height_match(
                        own_source,
                        authority,
                        pool.points[p],
                        own_source.overlay_error_m + authority.overlay_error_m + 16.0 * world_ulp,
                    )
            })
            .collect();
        points.sort_by(|&a, &b| {
            parameter(
                pool.points[a],
                pool.points[pool.root(edge.a)],
                pool.points[pool.root(edge.b)],
            )
            .total_cmp(&parameter(
                pool.points[b],
                pool.points[pool.root(edge.a)],
                pool.points[pool.root(edge.b)],
            ))
            .then(a.cmp(&b))
        });
        points.dedup();
        for &p in &points {
            own.entry(p).or_default().insert(index);
        }
        expanded[edge.ring].extend(points);
    }
    for (index, ring) in expanded.iter().enumerate() {
        if !simple(ring, &pool) {
            return Err(format!(
                "Anneau Boundary exporté non simple : {} contour {index}, erreur overlay {:.12} m.",
                precise[contours[index].face].source.group, max_error
            ));
        }
        let sign = area_ring(ring, &pool);
        if (contours[index].hole && sign >= 0.0) || (!contours[index].hole && sign <= 0.0) {
            return Err(format!(
                "Orientation d'anneau Boundary exporté invalide : {} contour {index}, aire {sign:.18}, points {:?}.",
                precise[contours[index].face].source.group,
                ring.iter()
                    .map(|&id| pool.points[pool.root(id)])
                    .collect::<Vec<_>>()
            ));
        }
    }
    let mut mesh = RoofMesh::default();
    let mut planes = vec![];
    let mut vertices = BTreeMap::new();
    for (face, raw) in precise.iter().enumerate() {
        let own = &face_rings[face];
        let outer = expanded[own[0]].clone();
        let holes: Vec<_> = own[1..].iter().map(|&i| expanded[i].clone()).collect();
        let expected = own
            .iter()
            .map(|&i| area_ring(&expanded[i], &pool))
            .sum::<f64>();
        let (joined, bridges) = bridge(outer, &holes, &pool)?;
        let plane = raw.source.plane;
        let den = libm::sqrt(plane.a * plane.a + plane.b * plane.b + 1.0);
        let n = [-plane.a / den, -plane.b / den, 1.0 / den];
        let triangles = ears(&joined, &pool, &masks[face], &precise, n).map_err(|error| {
            format!(
                "{error} Source {}. Anneau3D {:?}; normale {:?}; ponts {:?}.",
                raw.source.group,
                joined
                    .iter()
                    .map(|&i| pool.vertex(i, &precise))
                    .collect::<Vec<_>>(),
                n,
                bridges
            )
        })?;
        let mut triangle_edges = BTreeMap::<(usize, usize), (usize, i32)>::new();
        for tri in &triangles {
            for (a, b) in tri.iter().zip(tri.iter().cycle().skip(1)).take(3) {
                let key = ((*a).min(*b), (*a).max(*b));
                let entry = triangle_edges.entry(key).or_default();
                entry.0 += 1;
                entry.1 += if a < b { 1 } else { -1 };
            }
        }
        for &ring in own {
            for (a, b) in expanded[ring]
                .iter()
                .zip(expanded[ring].iter().cycle().skip(1))
                .take(expanded[ring].len())
            {
                let key = ((*a).min(*b), (*a).max(*b));
                if triangle_edges.remove(&key) != Some((1, if a < b { 1 } else { -1 })) {
                    return Err(format!(
                        "Rive Boundary non partagée dans la triangulation : {}.",
                        raw.source.group
                    ));
                }
            }
        }
        if triangle_edges.values().any(|&edge| edge != (2, 0)) {
            return Err(format!(
                "Diagonale Boundary sans deux faces opposées : {}.",
                raw.source.group
            ));
        }
        let mut actual = 0.0;
        let mut correction = 0.0;
        let mut products = 0.0;
        for tri in triangles {
            let v = tri.map(|i| pool.vertex(i, &precise));
            let ux = v[1].x - v[0].x;
            let uy = v[1].y - v[0].y;
            let uz = v[1].z - v[0].z;
            let vx = v[2].x - v[0].x;
            let vy = v[2].y - v[0].y;
            let vz = v[2].z - v[0].z;
            let cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
            if cross.iter().zip(n).map(|(a, b)| a * b).sum::<f64>() <= 0.0 {
                return Err(format!(
                    "Triangle Boundary exporté non positif : {}, sommets {:?}, normale {:?}, produit {:?}.",
                    raw.source.group, v, n, cross
                ));
            }
            let term = (ux * vy - uy * vx) * 0.5;
            let adjusted = term - correction;
            let next = actual + adjusted;
            correction = (next - actual) - adjusted;
            actual = next;
            products += (ux * vy).abs() + (uy * vx).abs();
            if mesh.faces.len() == MAX_ROOF_FACES {
                return Err(format!(
                    "Budget toitures réel pendant assemblage : 20001 > {MAX_ROOF_FACES} faces."
                ));
            }
            let mut ids = vec![];
            for (point, value) in tri.into_iter().zip(v) {
                let id = *vertices.entry(point).or_insert_with(|| {
                    let id = mesh.vertices.len() as u32;
                    mesh.vertices.push(value);
                    id
                });
                ids.push(id);
            }
            let s = &raw.source;
            mesh.faces.push(RoofFace {
                body_id: s.body_id.clone(),
                feature_id: s.feature_id.clone(),
                level: s.level,
                kind: s.kind,
                rf: s.rf.clone(),
                roof_group: s.group.clone(),
                component_id: s.component_id.clone(),
                vertices: ids,
                material: s.material.clone(),
                normal: n,
            });
            planes.push(Some(plane));
        }
        // Roundoff is bounded by the products evaluated, including cancellation
        // in thin positive facets; no geometric area threshold is applied.
        let error = 128.0 * (ulp(expected) + f64::EPSILON * products) * joined.len() as f64;
        if (actual - expected).abs() > error {
            return Err(format!(
                "Aire Boundary non conservée : {} ({actual:.12} != {expected:.12}).",
                raw.source.group
            ));
        }
    }
    // Non-height-field volumes retain their existing assembly, then consume
    // certified contacts from the fixed precise contour pool.
    for face in &mut legacy {
        face.source.boundary_triangulation = false;
    }
    append_volumes(
        &mut mesh,
        &mut planes,
        legacy,
        BoundaryContours {
            precise: &precise,
            pool: &pool,
            expanded: &expanded,
            contours: &contours,
            vertices: &vertices,
        },
    )?;
    Ok((mesh, planes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_ulp_beyond_a_long_edge_is_not_a_non_adjacent_touch() {
        let points = vec![
            Point {
                x: 48.425,
                y: -0.4249999952316294,
            },
            Point {
                x: 48.425,
                y: 48.425,
            },
            Point { x: 44.05, y: 44.05 },
            Point {
                x: 44.05,
                y: 3.950000000000001,
            },
            Point { x: 44.05, y: 3.95 },
            Point {
                x: 48.42499999523163,
                y: -0.4249999952316294,
            },
        ];
        // The rounded distance loses this one-ULP endpoint distinction.
        assert_eq!(distance_to_segment(points[4], points[2], points[3]), 0.0);
        assert!(!on_segment(points[4], points[2], points[3]));
        assert!(on_segment(points[3], points[2], points[4]));
        let (mesh, _) = build_contours(vec![face(points.clone(), "square", 0.0)], true).unwrap();
        assert_eq!(mesh.vertices.len(), points.len());
        assert_eq!(mesh.faces.len(), 4);
        for p in points {
            assert!(mesh.vertices.iter().any(|v| v.x == p.x && v.y == p.y));
        }
        assert!(mesh.faces.iter().all(|f| f.normal[2] > 0.0));
    }
    pub(super) fn face(points: Vec<Point>, group: &str, error: f64) -> RawFace {
        let source = Candidate {
            domain: vec![Polygon {
                outer: points.clone(),
                holes: vec![],
            }],
            plane: Plane {
                a: 0.0,
                b: 0.0,
                c: 3.0,
            },
            body_id: "body".into(),
            feature_id: None,
            floor_z_m: 0.0,
            envelope: Envelope::Walled,
            component_id: None,
            level: 0,
            rf: "RF-FLAT".into(),
            group: group.into(),
            layer: "main".into(),
            material: "MAT-STONE".into(),
            kind: RoofFaceKind::Pan,
            corbel: false,
            nested: false,
            boundary_triangulation: true,
            whole_boundary: true,
            overlay_error_m: error,
            material_contours: Rc::new(vec![MaterialContour {
                id: group.into(),
                points: points.clone(),
            }]),
            plan_id: 0,
            creation_planes: Rc::new(vec![]),
            native_domain: None,
            native_anchor: None,
            native_minimum: Rc::new(vec![]),
            native_peers: Rc::new(vec![]),
        };
        RawFace {
            vertices: points
                .into_iter()
                .map(|p| Vertex3 {
                    x: p.x,
                    y: p.y,
                    z: 3.0,
                })
                .collect(),
            source,
        }
    }
    #[test]
    fn a_positive_raw_microfacet_is_exported_without_a_weld_or_area_filter() {
        let points = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 10.0, y: 0.0 },
            Point { x: 10.0, y: 1e-12 },
        ];
        let (mesh, _, notes) = build(vec![face(points.clone(), "micro", 0.0)]).unwrap();
        assert!(notes.is_empty());
        assert_eq!(mesh.faces.len(), 1);
        assert_eq!(mesh.faces[0].normal, [0.0, 0.0, 1.0]);
        for p in points {
            assert!(mesh.vertices.iter().any(|v| v.x == p.x && v.y == p.y));
        }
    }
    #[test]
    fn a_hole_touching_its_outer_graph_node_uses_that_existing_junction() {
        let mut raw = face(
            vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 4.0, y: 0.0 },
                Point { x: 4.0, y: 4.0 },
                Point { x: 0.0, y: 4.0 },
            ],
            "touch",
            0.0,
        );
        raw.source.domain[0].holes.push(vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 2.0, y: 2.0 },
            Point { x: 1.0, y: 0.5 },
        ]);
        let (mesh, _) = build_contours(vec![raw], true).unwrap();
        let projected = mesh
            .faces
            .iter()
            .map(|f| {
                let a = &mesh.vertices[f.vertices[0] as usize];
                let b = &mesh.vertices[f.vertices[1] as usize];
                let c = &mesh.vertices[f.vertices[2] as usize];
                ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
            })
            .sum::<f64>();
        assert_eq!(projected, 15.5);
        assert_eq!(mesh.faces.len(), 5);
    }
    #[test]
    fn an_inverted_certified_corner_uses_one_labelled_arrangement() {
        let points = vec![
            Point {
                x: 15.74256866844443,
                y: 10.179907305762171,
            },
            Point {
                x: 15.767000016291416,
                y: 10.165000005289912,
            },
            Point {
                x: 16.065999981482303,
                y: 9.99099998049438,
            },
            Point {
                x: 16.068575349171436,
                y: 9.989580555483698,
            },
            Point {
                x: 16.07094464870242,
                y: 9.993763944730162,
            },
            Point {
                x: 16.117117997725284,
                y: 9.967590092346072,
            },
            Point {
                x: 15.907207843382633,
                y: 10.086579902693629,
            },
        ];
        let neighbour = vec![
            Point {
                x: 16.070944638570293,
                y: 9.993763954043388,
            },
            Point {
                x: 16.06857533903931,
                y: 9.989580572247505,
            },
            Point { x: 16.2, y: 9.9 },
        ];
        let mut raw = vec![face(points, "first", 4e-7), face(neighbour, "second", 4e-7)];
        // This captured fixture consists of already-clipped faces. Those
        // derived contours are not authoritative material operands.
        for face in &mut raw {
            face.source.material_contours = Rc::new(vec![]);
        }
        let before = raw.iter().map(|f| area(&f.source.domain)).sum::<f64>();
        let (mesh, _, notes) = build(raw).unwrap();
        assert_eq!(notes.len(), 1);
        let mut sum = 0.0;
        for face in &mesh.faces {
            let p: Vec<_> = face
                .vertices
                .iter()
                .map(|&i| Point {
                    x: mesh.vertices[i as usize].x,
                    y: mesh.vertices[i as usize].y,
                })
                .collect();
            let area = ((p[1].x - p[0].x) * (p[2].y - p[0].y)
                - (p[1].y - p[0].y) * (p[2].x - p[0].x))
                * 0.5;
            assert!(area > 0.0);
            sum += area;
        }
        assert!((sum - before).abs() < 1e-8);
    }
}
