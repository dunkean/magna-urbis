//! Native finite arrangement with exact identities and symbolic side labels.
use super::*;
use num_traits::Zero;
use std::cmp::Ordering;
#[path = "boundary_exact.rs"]
mod exact;
use exact::{P, Q, R, cross, rational, sign};
#[path = "boundary_chains.rs"]
mod chains;
#[path = "boundary_offsets.rs"]
mod generated;

pub(super) type NativeResult = (Vec<Candidate>, BTreeMap<String, Surface>, Vec<String>);
#[derive(Clone)]
struct Segment {
    a: Q,
    b: Q,
    line: P,
    equality: bool,
    nodes: BTreeSet<usize>,
    bbox: [f64; 4],
    rounded_endpoints: [Point; 2],
}
#[derive(Clone)]
struct Node {
    q: Q,
    point: Point,
    supports: BTreeSet<usize>,
    native: bool,
}
#[derive(Clone, Copy)]
struct Directed {
    a: usize,
    b: usize,
    left: usize,
}
struct Probe {
    m: Q,
    n: Q,
    point: Point,
}
struct Ring {
    raw: Vec<Point>,
    q: Vec<Q>,
}
struct Poly {
    outer: Ring,
    holes: Vec<Ring>,
}
type S = Vec<Poly>;
struct Base {
    eaves: S,
    cores: S,
    declared: Vec<S>,
    lot: S,
    excluded: Vec<S>,
}
struct Domain {
    base: usize,
    arm: Option<S>,
    slab: Option<S>,
}
fn surface(s: &Surface) -> S {
    s.iter()
        .map(|p| Poly {
            outer: ring(&p.outer),
            holes: p.holes.iter().map(|r| ring(r)).collect(),
        })
        .collect()
}
fn ring(r: &[Point]) -> Ring {
    Ring {
        raw: r.to_vec(),
        q: r.iter().copied().map(Q::from).collect(),
    }
}
fn inside_box(p: Point, b: [f64; 4]) -> bool {
    p.x >= b[0] && p.y >= b[1] && p.x <= b[2] && p.y <= b[3]
}
fn intersect_box(a: [f64; 4], b: [f64; 4]) -> Option<[f64; 4]> {
    let q = [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ];
    (q[0] <= q[2] && q[1] <= q[3]).then_some(q)
}
fn surface_box(surface: &S) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in surface.iter().flat_map(|p| &p.outer.raw) {
        b[0] = b[0].min(p.x);
        b[1] = b[1].min(p.y);
        b[2] = b[2].max(p.x);
        b[3] = b[3].max(p.y);
    }
    let margin = 2.0 * ulp(b.iter().map(|x| x.abs()).fold(0.0, f64::max));
    [b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin]
}
fn y_side(y: f64, exact_y: &R, q: &Q, n: &Q, point: Point) -> i8 {
    let dy = y - point.y;
    if dy.abs() > ulp(y.abs().max(point.y.abs())) * 2.0 {
        return if dy > 0.0 { 1 } else { -1 };
    }
    exact::lex(exact_y - &q.y, || -&n.y)
}
fn ring_contains(r: &Ring, p: &Probe) -> bool {
    let mut winding = 0i32;
    for i in 0..r.raw.len() {
        let j = (i + 1) % r.raw.len();
        let a = r.raw[i];
        let b = r.raw[j];
        let ay = y_side(a.y, &r.q[i].y, &p.m, &p.n, p.point);
        let by = y_side(b.y, &r.q[j].y, &p.m, &p.n, p.point);
        if !((ay <= 0 && by > 0) || (ay > 0 && by <= 0)) {
            continue;
        }
        let mut side = exact::orientation_q(&r.q[i], &r.q[j], &p.m, a, b, p.point);
        if side == 0 {
            side = sign(&cross(&r.q[j].sub(&r.q[i]), &p.n));
        }
        if ay <= 0 && by > 0 && side > 0 {
            winding += 1;
        }
        if ay > 0 && by <= 0 && side < 0 {
            winding -= 1;
        }
    }
    winding != 0
}
fn contains(s: &S, p: &Probe) -> bool {
    s.iter().any(|poly| {
        ring_contains(&poly.outer, p) && !poly.holes.iter().any(|h| ring_contains(h, p))
    })
}
fn base_contains(b: &Base, p: &Probe) -> bool {
    contains(&b.eaves, p)
        && (!contains(&b.cores, p) || b.declared.iter().any(|s| contains(s, p)))
        && (b.lot.is_empty() || contains(&b.lot, p))
        && !b.excluded.iter().any(|s| contains(s, p))
}
struct Labels<'a> {
    candidates: &'a [Candidate],
    boxes: Vec<[f64; 4]>,
    bases: Vec<Base>,
    domains: Vec<Domain>,
    owners: Vec<usize>,
    planes: Vec<P>,
    minima: Vec<Vec<P>>,
    classes: Vec<usize>,
}
impl<'a> Labels<'a> {
    fn new(candidates: &'a [Candidate]) -> Result<Self, String> {
        let mut bases = vec![];
        let mut domains = vec![];
        let mut owners = vec![];
        let mut bi = BTreeMap::new();
        let mut di = BTreeMap::new();
        for c in candidates {
            let d = c.native_domain.as_ref().unwrap();
            let base_key = Rc::as_ptr(&d.base) as usize;
            let base = if let Some(&id) = bi.get(&base_key) {
                id
            } else {
                let b = &d.base;
                let id = bases.len();
                bases.push(Base {
                    eaves: generated::surface(&b.eaves, b.eaves_recipe.as_ref())?,
                    cores: generated::surface(&b.cores, b.cores_recipe.as_ref())?,
                    declared: b.declared.iter().map(surface).collect(),
                    lot: surface(&b.lot),
                    excluded: b.excluded.iter().map(surface).collect(),
                });
                bi.insert(base_key, id);
                id
            };
            let key = Rc::as_ptr(d) as usize;
            let owner = if let Some(&id) = di.get(&key) {
                id
            } else {
                let id = domains.len();
                domains.push(Domain {
                    base,
                    arm: d
                        .arm
                        .as_ref()
                        .map(|s| generated::surface(s, d.arm_recipe.as_ref()))
                        .transpose()?,
                    slab: d.slab.as_ref().map(surface),
                });
                di.insert(key, id);
                id
            };
            owners.push(owner);
        }
        let boxes: Vec<_> = owners
            .iter()
            .map(|&id| {
                let d = &domains[id];
                let mut b = surface_box(&bases[d.base].eaves);
                for s in d.arm.iter().chain(&d.slab) {
                    b = intersect_box(b, surface_box(s)).unwrap_or([1.0, 1.0, 0.0, 0.0]);
                }
                b
            })
            .collect();
        let planes: Vec<_> = candidates
            .iter()
            .zip(&boxes)
            .map(|(c, &b)| generated::plane(c.plane, c.native_anchor.as_ref(), b))
            .collect::<Result<_, _>>()?;
        let minima = candidates
            .iter()
            .zip(&boxes)
            .map(|(c, &b)| {
                c.native_minimum
                    .iter()
                    .map(|p| generated::plane(p.plane, p.anchor.as_ref(), b))
                    .collect::<Result<Vec<_>, _>>()
            })
            .collect::<Result<_, _>>()?;
        let classes = (0..candidates.len())
            .map(|i| {
                (0..i)
                    .find(|&j| {
                        let a = &candidates[i];
                        let b = &candidates[j];
                        planes[i] == planes[j]
                            && a.group == b.group
                            && a.body_id == b.body_id
                            && a.feature_id == b.feature_id
                            && a.material == b.material
                            && a.kind == b.kind
                    })
                    .unwrap_or(i)
            })
            .collect();
        Ok(Self {
            candidates,
            boxes,
            bases,
            domains,
            owners,
            planes,
            minima,
            classes,
        })
    }
    fn at(&self, p: &Probe) -> Option<usize> {
        let mut bases = BTreeMap::new();
        let mut domains = BTreeMap::new();
        let mut winner: Option<usize> = None;
        for (i, c) in self.candidates.iter().enumerate() {
            let b = self.boxes[i];
            let margin = 4.0 * ulp(b.iter().map(|x| x.abs()).fold(0.0, f64::max));
            if !inside_box(
                p.point,
                [b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin],
            ) {
                continue;
            }
            let id = self.owners[i];
            let d = &self.domains[id];
            let active = *domains.entry(id).or_insert_with(|| {
                *bases
                    .entry(d.base)
                    .or_insert_with(|| base_contains(&self.bases[d.base], p))
                    && d.arm.as_ref().is_none_or(|s| contains(s, p))
                    && d.slab.as_ref().is_none_or(|s| contains(s, p))
            });
            if !active
                || self.minima[i]
                    .iter()
                    .any(|q| plane_cmp(&self.planes[i], q, p) > 0)
            {
                continue;
            }
            if let Some(j) = winner {
                let cmp = plane_cmp(&self.planes[i], &self.planes[j], p);
                if cmp > 0 || (cmp == 0 && c.plan_id < self.candidates[j].plan_id) {
                    winner = Some(i);
                }
            } else {
                winner = Some(i);
            }
        }
        winner.map(|i| self.classes[i])
    }
}
fn plane_cmp(a: &P, b: &P, p: &Probe) -> i8 {
    let d = a.minus(b);
    exact::lex(d.value(&p.m), || d.derivative(&p.n))
}
fn node(
    nodes: &mut Vec<Node>,
    index: &mut BTreeMap<Q, usize>,
    q: Q,
    support: usize,
    native: bool,
) -> Result<usize, String> {
    if let Some(&id) = index.get(&q) {
        nodes[id].supports.insert(support);
        nodes[id].native |= native;
        return Ok(id);
    }
    let point = q.point()?;
    let id = nodes.len();
    index.insert(q.clone(), id);
    nodes.push(Node {
        q,
        point,
        supports: BTreeSet::from([support]),
        native,
    });
    Ok(id)
}
fn add_segment(
    segments: &mut Vec<Segment>,
    nodes: &mut Vec<Node>,
    index: &mut BTreeMap<Q, usize>,
    a: Q,
    b: Q,
    equality: bool,
) -> Result<(), String> {
    if a == b {
        return Ok(());
    }
    if segments
        .iter()
        .any(|s| (s.a == a && s.b == b) || (s.a == b && s.b == a))
    {
        return Ok(());
    }
    let id = segments.len();
    let x = node(nodes, index, a.clone(), id, !equality)?;
    let y = node(nodes, index, b.clone(), id, !equality)?;
    let one = nodes[x].point;
    let two = nodes[y].point;
    debug_assert!(nodes[x].q == a && nodes[y].q == b);
    segments.push(Segment {
        line: P::edge(&a, &b),
        a,
        b,
        equality,
        nodes: BTreeSet::from([x, y]),
        bbox: [
            one.x.min(two.x),
            one.y.min(two.y),
            one.x.max(two.x),
            one.y.max(two.y),
        ],
        rounded_endpoints: [one, two],
    });
    Ok(())
}
fn add_surface(
    s: &S,
    clip: [f64; 4],
    segments: &mut Vec<Segment>,
    nodes: &mut Vec<Node>,
    index: &mut BTreeMap<Q, usize>,
) -> Result<(), String> {
    for r in s
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
    {
        for i in 0..r.q.len() {
            let j = (i + 1) % r.q.len();
            let a = r.raw[i];
            let b = r.raw[j];
            if intersect_box(
                [a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)],
                clip,
            )
            .is_some()
            {
                add_segment(
                    segments,
                    nodes,
                    index,
                    r.q[i].clone(),
                    r.q[j].clone(),
                    false,
                )?;
            }
        }
    }
    Ok(())
}
fn equality_segment(a: &P, b: &P, clip: [f64; 4]) -> Option<(Q, Q)> {
    let d = a.minus(b);
    let clip = clip.map(rational);
    let mut hits = BTreeSet::new();
    if !d.b.is_zero() {
        for x in [&clip[0], &clip[2]] {
            let y = -(&d.a * x + &d.c) / &d.b;
            if y >= clip[1] && y <= clip[3] {
                hits.insert(Q { x: x.clone(), y });
            }
        }
    }
    if !d.a.is_zero() {
        for y in [&clip[1], &clip[3]] {
            let x = -(&d.b * y + &d.c) / &d.a;
            if x >= clip[0] && x <= clip[2] {
                hits.insert(Q { x, y: y.clone() });
            }
        }
    }
    (hits.len() > 1).then(|| (hits.first().unwrap().clone(), hits.last().unwrap().clone()))
}
fn between(p: &Q, s: &Segment) -> bool {
    p.x >= s.a.x.clone().min(s.b.x.clone())
        && p.x <= s.a.x.clone().max(s.b.x.clone())
        && p.y >= s.a.y.clone().min(s.b.y.clone())
        && p.y <= s.a.y.clone().max(s.b.y.clone())
}
fn line_key(p: &P) -> (R, R, R) {
    let factor = if !p.a.is_zero() { &p.a } else { &p.b };
    (&p.a / factor, &p.b / factor, &p.c / factor)
}
fn intersections(
    segments: &mut [Segment],
    nodes: &mut Vec<Node>,
    index: &mut BTreeMap<Q, usize>,
) -> Result<(), String> {
    let mut order: Vec<_> = (0..segments.len()).collect();
    order.sort_by(|&a, &b| {
        segments[a].bbox[0]
            .total_cmp(&segments[b].bbox[0])
            .then(a.cmp(&b))
    });
    for (ii, &i) in order.iter().enumerate() {
        let a_box = segments[i].bbox;
        for &j in &order[ii + 1..] {
            let b_box = segments[j].bbox;
            let margin = 16.0
                * ulp(a_box
                    .iter()
                    .chain(&b_box)
                    .map(|x| x.abs())
                    .fold(0.0, f64::max));
            if b_box[0] > a_box[2] + margin {
                break;
            }
            if b_box[1] > a_box[3] + margin || b_box[3] < a_box[1] - margin {
                continue;
            }
            let d = segments[i].b.sub(&segments[i].a);
            let e = segments[j].b.sub(&segments[j].a);
            let den = cross(&d, &e);
            if den.is_zero() {
                continue;
            }
            let delta = segments[j].a.sub(&segments[i].a);
            let t = cross(&delta, &e) / &den;
            let u = cross(&delta, &d) / den;
            if t < R::zero() || t > rational(1.0) || u < R::zero() || u > rational(1.0) {
                continue;
            }
            let q = Q {
                x: &segments[i].a.x + &t * &d.x,
                y: &segments[i].a.y + &t * &d.y,
            };
            let id = node(nodes, index, q, i, false)?;
            nodes[id].supports.insert(j);
            segments[i].nodes.insert(id);
            segments[j].nodes.insert(id);
        }
    }
    // Propagate all exact subdivision points across overlapping finite supports.
    let mut lines = BTreeMap::<(R, R, R), Vec<usize>>::new();
    for (i, s) in segments.iter().enumerate() {
        lines.entry(line_key(&s.line)).or_default().push(i);
    }
    for supports in lines.values() {
        if supports.len() < 2 {
            continue;
        }
        let ids: BTreeSet<_> = supports
            .iter()
            .flat_map(|&i| segments[i].nodes.iter().copied())
            .collect();
        for &i in supports {
            for &id in &ids {
                if between(&nodes[id].q, &segments[i]) {
                    segments[i].nodes.insert(id);
                    nodes[id].supports.insert(i);
                }
            }
        }
    }
    Ok(())
}
fn halfedges(
    segments: &[Segment],
    nodes: &[Node],
    labels: &Labels<'_>,
) -> Result<Vec<Directed>, String> {
    let mut edges = BTreeSet::new();
    for (support, s) in segments.iter().enumerate() {
        let d = s.b.sub(&s.a);
        let mut ids: Vec<_> = s.nodes.iter().copied().collect();
        let forward = if !d.x.is_zero() {
            sign(&d.x)
        } else {
            sign(&d.y)
        };
        ids.sort_by(|&a, &b| {
            let order = if !d.x.is_zero() {
                nodes[a].q.x.cmp(&nodes[b].q.x)
            } else {
                nodes[a].q.y.cmp(&nodes[b].q.y)
            };
            if forward > 0 { order } else { order.reverse() }
        });
        let n = Q { x: -&d.y, y: d.x };
        for pair in ids.windows(2) {
            let m = nodes[pair[0]].q.add(&nodes[pair[1]].q).half();
            let point = m.point()?;
            for (j, other) in segments.iter().enumerate() {
                if j == support || !inside_box(point, other.bbox) {
                    continue;
                }
                if !exact::non_incident(
                    other.rounded_endpoints[0],
                    other.rounded_endpoints[1],
                    point,
                ) && other.line.value(&m).is_zero()
                    && between(&m, other)
                    && !cross(&s.b.sub(&s.a), &other.b.sub(&other.a)).is_zero()
                {
                    return Err(format!(
                        "Subdivision Boundary exacte manquante : {support}/{j}."
                    ));
                }
            }
            let one = labels.at(&Probe {
                m: m.clone(),
                n: n.clone(),
                point,
            });
            let two = labels.at(&Probe {
                m,
                n: n.neg(),
                point,
            });
            if one == two {
                continue;
            }
            if let Some(owner) = one {
                edges.insert((pair[0], pair[1], owner));
            }
            if let Some(owner) = two {
                edges.insert((pair[1], pair[0], owner));
            }
        }
    }
    Ok(edges
        .into_iter()
        .map(|(a, b, left)| Directed { a, b, left })
        .collect())
}
fn angular(a: &Q, b: &Q) -> Ordering {
    let upper = |q: &Q| sign(&q.y) > 0 || (q.y.is_zero() && sign(&q.x) >= 0);
    upper(b)
        .cmp(&upper(a))
        .then_with(|| match sign(&cross(a, b)) {
            1 => Ordering::Less,
            -1 => Ordering::Greater,
            _ => Ordering::Equal,
        })
}
fn signed_exact(r: &[usize], nodes: &[Node]) -> R {
    let origin = &nodes[r[0]].q;
    let mut sum = R::zero();
    for (&a, &b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
        sum += cross(&nodes[a].q.sub(origin), &nodes[b].q.sub(origin));
    }
    sum / rational(2.0)
}
fn ring_membership(r: &[usize], p: &Q, nodes: &[Node]) -> Option<bool> {
    let mut winding = 0;
    for (&i, &j) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
        let a = &nodes[i].q;
        let b = &nodes[j].q;
        let side = sign(&cross(&b.sub(a), &p.sub(a)));
        if side == 0
            && p.x >= a.x.clone().min(b.x.clone())
            && p.x <= a.x.clone().max(b.x.clone())
            && p.y >= a.y.clone().min(b.y.clone())
            && p.y <= a.y.clone().max(b.y.clone())
        {
            return None;
        }
        if a.y <= p.y && b.y > p.y && side > 0 {
            winding += 1;
        }
        if a.y > p.y && b.y <= p.y && side < 0 {
            winding -= 1;
        }
    }
    Some(winding != 0)
}
fn trace(edges: &[Directed], nodes: &[Node]) -> Result<BTreeMap<usize, Surface>, String> {
    let mut outgoing = BTreeMap::<(usize, usize), Vec<usize>>::new();
    for (i, e) in edges.iter().enumerate() {
        outgoing.entry((e.a, e.left)).or_default().push(i);
    }
    for ((a, _), ids) in &mut outgoing {
        ids.sort_by(|&i, &j| {
            angular(
                &nodes[edges[i].b].q.sub(&nodes[*a].q),
                &nodes[edges[j].b].q.sub(&nodes[*a].q),
            )
            .then(i.cmp(&j))
        });
    }
    let mut visited = vec![false; edges.len()];
    let mut by_label = BTreeMap::<usize, Vec<Vec<usize>>>::new();
    for start in 0..edges.len() {
        if visited[start] {
            continue;
        }
        let mut current = start;
        let mut ring = vec![];
        loop {
            if visited[current] {
                if current != start {
                    return Err("Cycle Boundary exact rejoint une autre occurrence.".into());
                }
                break;
            }
            visited[current] = true;
            let e = edges[current];
            ring.push(e.a);
            let choices = outgoing.get(&(e.b, e.left)).ok_or_else(|| {
                format!(
                    "Cycle Boundary exact ouvert : nœud {} / label {}.",
                    e.b, e.left
                )
            })?;
            let reverse = nodes[e.a].q.sub(&nodes[e.b].q);
            let position = choices.partition_point(|&id| {
                angular(&nodes[edges[id].b].q.sub(&nodes[e.b].q), &reverse) == Ordering::Less
            });
            current = choices[(position + choices.len() - 1) % choices.len()];
            if ring.len() > edges.len() {
                return Err("Cycle Boundary exact non borné.".into());
            }
        }
        if ring.len() < 3 || signed_exact(&ring, nodes).is_zero() {
            return Err("Cycle Boundary exact non surfacique.".into());
        }
        by_label.entry(edges[start].left).or_default().push(ring);
    }
    let mut result = BTreeMap::new();
    for (owner, all) in by_label {
        let mut outers = vec![];
        let mut holes = vec![];
        for r in all {
            let area = signed_exact(&r, nodes);
            if sign(&area) > 0 {
                outers.push((r, area, vec![]));
            } else {
                holes.push(r);
            }
        }
        for hole in holes {
            let mut containers = vec![];
            for (i, (outer, _, _)) in outers.iter().enumerate() {
                if hole
                    .iter()
                    .find_map(|&id| ring_membership(outer, &nodes[id].q, nodes))
                    == Some(true)
                {
                    containers.push(i);
                }
            }
            let Some(owner) = containers
                .into_iter()
                .min_by(|&a, &b| outers[a].1.cmp(&outers[b].1))
            else {
                return Err("Trou Boundary exact sans contour extérieur.".into());
            };
            outers[owner].2.push(hole);
        }
        let to_ring = |r: Vec<usize>| r.into_iter().map(|i| nodes[i].point).collect();
        result.insert(
            owner,
            outers
                .into_iter()
                .map(|(r, _, h)| Polygon {
                    outer: to_ring(r),
                    holes: h.into_iter().map(to_ring).collect(),
                })
                .collect(),
        );
    }
    Ok(result)
}
fn export_guards(edges: &[Directed], nodes: &[Node]) -> Result<(), String> {
    let used: BTreeSet<_> = edges.iter().flat_map(|e| [e.a, e.b]).collect();
    let mut bits = BTreeMap::new();
    for &id in &used {
        let p = nodes[id].point;
        let key = (p.x.to_bits(), p.y.to_bits());
        if let Some(other) = bits.insert(key, id)
            && nodes[id].q != nodes[other].q
        {
            let incident = |i| {
                edges
                    .iter()
                    .filter(|e| e.a == i || e.b == i)
                    .map(|e| (e.a, e.b, e.left))
                    .collect::<Vec<_>>()
            };
            return Err(format!(
                "Deux nœuds Boundary exacts exportent les mêmes bits : {other}/{id}, XY {p:?}, delta exact {:?}, premier supports {:?} natif {} incidences {:?}, second supports {:?} natif {} incidences {:?}.",
                nodes[id].q.sub(&nodes[other].q),
                nodes[other].supports,
                nodes[other].native,
                incident(other),
                nodes[id].supports,
                nodes[id].native,
                incident(id)
            ));
        }
    }
    let unique: BTreeSet<_> = edges
        .iter()
        .map(|e| if e.a < e.b { (e.a, e.b) } else { (e.b, e.a) })
        .collect();
    for (a, b) in unique {
        let one = nodes[a].point;
        let two = nodes[b].point;
        let bbox = [
            one.x.min(two.x),
            one.y.min(two.y),
            one.x.max(two.x),
            one.y.max(two.y),
        ];
        let d = nodes[b].q.sub(&nodes[a].q);
        for &id in &used {
            if id == a || id == b || !inside_box(nodes[id].point, bbox) {
                continue;
            }
            let before = sign(&cross(&d, &nodes[id].q.sub(&nodes[a].q)));
            let after = orient(one, two, nodes[id].point);
            if before != after {
                return Err(format!(
                    "Arrondi Boundary change le côté exporté : arête {a}/{b}, nœud {id}, {before}/{after}. A {:?} Q {:?} supports {:?} native {}; B {:?} Q {:?} supports {:?} native {}; C {:?} Q {:?} supports {:?} native {}.",
                    one,
                    nodes[a].q,
                    nodes[a].supports,
                    nodes[a].native,
                    two,
                    nodes[b].q,
                    nodes[b].supports,
                    nodes[b].native,
                    nodes[id].point,
                    nodes[id].q,
                    nodes[id].supports,
                    nodes[id].native
                ));
            }
        }
    }
    Ok(())
}

/// Contract only a global, exactly collinear degree-two subdivision with
/// unchanged labels. Material corners and all positive cycles stay distinct.
fn contract_chains(edges: Vec<Directed>, nodes: &[Node]) -> Result<(Vec<Directed>, usize), String> {
    Ok(chains::reduce(edges, nodes, |_, _| {}))
}
fn layer(candidates: &[Candidate]) -> Result<NativeResult, String> {
    let labels = Labels::new(candidates)?;
    let mut clip = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for b in &labels.boxes {
        clip[0] = clip[0].min(b[0]);
        clip[1] = clip[1].min(b[1]);
        clip[2] = clip[2].max(b[2]);
        clip[3] = clip[3].max(b[3]);
    }
    let mut segments = vec![];
    let mut nodes = vec![];
    let mut index = BTreeMap::new();
    for b in &labels.bases {
        for s in [&b.eaves, &b.cores, &b.lot]
            .into_iter()
            .chain(&b.declared)
            .chain(&b.excluded)
        {
            add_surface(s, clip, &mut segments, &mut nodes, &mut index)?;
        }
    }
    for d in &labels.domains {
        for s in d.arm.iter().chain(&d.slab) {
            add_surface(s, clip, &mut segments, &mut nodes, &mut index)?;
        }
    }
    for i in 0..candidates.len() {
        for j in i + 1..candidates.len() {
            let Some(common) = intersect_box(labels.boxes[i], labels.boxes[j]) else {
                continue;
            };
            if let Some((p, q)) = equality_segment(&labels.planes[i], &labels.planes[j], common) {
                add_segment(&mut segments, &mut nodes, &mut index, p, q, true)?;
            }
        }
    }
    intersections(&mut segments, &mut nodes, &mut index)?;
    let (edges, contracted) = contract_chains(halfedges(&segments, &nodes, &labels)?, &nodes)?;
    export_guards(&edges, &nodes)?;
    let faces = trace(&edges, &nodes)?;
    let mut out = vec![];
    for (owner, surface) in faces {
        for polygon in surface {
            let mut source = candidates[owner].clone();
            source.domain = vec![polygon];
            source.whole_boundary = true;
            source.overlay_error_m = 0.0;
            source.native_peers = Rc::new(vec![]);
            out.push(source);
        }
    }
    let mut group_ids = BTreeMap::new();
    for c in candidates {
        let next = group_ids.len();
        group_ids.entry(c.group.clone()).or_insert(next);
    }
    let mut group_edges = BTreeMap::<(usize, usize), BTreeSet<usize>>::new();
    for e in &edges {
        group_edges
            .entry((e.a, e.b))
            .or_default()
            .insert(group_ids[&candidates[e.left].group]);
    }
    let mut united = vec![];
    for (&(a, b), owners) in &group_edges {
        for &left in owners {
            if group_edges.get(&(b, a)).is_some_and(|s| s.contains(&left)) {
                continue;
            }
            united.push(Directed { a, b, left });
        }
    }
    let mut surfaces = trace(&united, &nodes)?;
    let groups = group_ids
        .into_iter()
        .filter_map(|(name, id)| surfaces.remove(&id).map(|s| (name, s)))
        .collect();
    let native_count = nodes.iter().filter(|n| n.native).count();
    let equality_count = segments.iter().filter(|s| s.equality).count();
    let note = format!(
        "roof: graphe Boundary natif exact, {} supports finis, {} nœuds rationnels, {} demi-arêtes, {} domaines de plans ; arrondi pair et contrôles exportés, {native_count} sommets natifs et {equality_count} égalités, {contracted} subdivisions de chaînes collinéaires exactement nulles.",
        segments.len(),
        nodes.len(),
        edges.len(),
        out.len()
    );
    Ok((out, groups, vec![note]))
}
pub(super) fn build(candidates: &[Candidate]) -> Result<NativeResult, String> {
    let mut layers = BTreeMap::<(String, u64), Vec<Candidate>>::new();
    for c in candidates {
        layers
            .entry((c.layer.clone(), c.floor_z_m.to_bits()))
            .or_default()
            .push(c.clone());
    }
    let mut out = vec![];
    let mut groups = BTreeMap::new();
    let mut notes = vec![];
    for (key, candidates) in layers {
        let (mut faces, domains, mut messages) = layer(&candidates).map_err(|e| {
            format!(
                "{e} Couche native {} / plancher {}.",
                key.0,
                f64::from_bits(key.1)
            )
        })?;
        out.append(&mut faces);
        for (name, domain) in domains {
            if groups.insert(name.clone(), domain).is_some() {
                return Err(format!(
                    "Groupe Boundary natif partagé par deux planchers : {name}."
                ));
            }
        }
        notes.append(&mut messages);
    }
    Ok((out, groups, notes))
}
#[cfg(test)]
fn signed(r: &[Point]) -> f64 {
    let origin = Q::from(r[0]);
    let mut sum = R::zero();
    for (&a, &b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
        sum += cross(&Q::from(a).sub(&origin), &Q::from(b).sub(&origin));
    }
    exact::rounded(&(sum / rational(2.0))).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn journal(nodes: &[Node], segments: &[Segment]) -> Vec<serde_json::Value> {
        nodes.iter().map(|n| {
            let equality=n.supports.iter().filter(|&&i|segments[i].equality).count();
            let material=n.supports.len()-equality;
            let nature=if n.native {"native"}else if equality>0&&material>0 {"E×L"}else if equality>1 {"L×L"}else {"E×E"};
            serde_json::json!({"nature":nature,"bits":[n.point.x.to_bits(),n.point.y.to_bits()],"error":[(&n.q.x-rational(n.point.x)).to_string(),(&n.q.y-rational(n.point.y)).to_string()]})
        }).collect()
    }
    #[test]
    fn reduced_rational_identities_keep_true_and_false_triples_distinct() {
        let mut segments = vec![];
        let mut nodes = vec![];
        let mut index = BTreeMap::new();
        let point = |x, y| Q::from(Point { x, y });
        add_segment(
            &mut segments,
            &mut nodes,
            &mut index,
            point(-1.0, 0.0),
            point(1.0, 0.0),
            true,
        )
        .unwrap();
        add_segment(
            &mut segments,
            &mut nodes,
            &mut index,
            point(0.0, -1.0),
            point(0.0, 1.0),
            true,
        )
        .unwrap();
        add_segment(
            &mut segments,
            &mut nodes,
            &mut index,
            point(-1.0, 1.0),
            point(1.0, -1.0),
            true,
        )
        .unwrap();
        intersections(&mut segments, &mut nodes, &mut index).unwrap();
        assert_eq!(nodes.iter().filter(|n| n.q == point(0.0, 0.0)).count(), 1);
        assert_eq!(
            nodes
                .iter()
                .find(|n| n.q == point(0.0, 0.0))
                .unwrap()
                .supports
                .len(),
            3
        );
        assert!(
            journal(&nodes, &segments)
                .iter()
                .any(|v| v["nature"] == "L×L")
        );
        let mut segments = vec![];
        let mut nodes = vec![];
        let mut index = BTreeMap::new();
        add_segment(
            &mut segments,
            &mut nodes,
            &mut index,
            point(-1.0, 0.0),
            point(1.0, 0.0),
            false,
        )
        .unwrap();
        add_segment(
            &mut segments,
            &mut nodes,
            &mut index,
            point(0.0, -1.0),
            point(0.0, 1.0),
            false,
        )
        .unwrap();
        add_segment(
            &mut segments,
            &mut nodes,
            &mut index,
            point(-1e-8, 2e-8),
            point(2e-8, -1e-8),
            false,
        )
        .unwrap();
        intersections(&mut segments, &mut nodes, &mut index).unwrap();
        assert_eq!(nodes.iter().filter(|n| !n.native).count(), 3);
        assert_eq!(index.len(), nodes.len());
    }
    #[test]
    fn non_adjacent_exact_nodes_with_identical_export_bits_are_rejected() {
        let make = |q: Q| Node {
            point: q.point().unwrap(),
            q,
            supports: BTreeSet::new(),
            native: false,
        };
        let a = Q::from(Point { x: 1.0, y: 1.0 });
        let mut b = a.clone();
        b.x += rational(ulp(1.0)) / rational(4.0);
        let nodes = vec![
            make(a),
            make(Q::from(Point { x: 2.0, y: 1.0 })),
            make(b),
            make(Q::from(Point { x: 1.0, y: 2.0 })),
        ];
        let edges = [
            Directed {
                a: 0,
                b: 1,
                left: 0,
            },
            Directed {
                a: 2,
                b: 3,
                left: 1,
            },
        ];
        assert!(
            export_guards(&edges, &nodes)
                .unwrap_err()
                .contains("mêmes bits")
        );
    }
    #[test]
    fn exact_plane_difference_certifies_the_same_triple_algebraically() {
        let a = P::from(Plane {
            a: 0.3,
            b: 0.7,
            c: 2.1,
        });
        let b = P::from(Plane {
            a: 0.8,
            b: -0.2,
            c: 3.3,
        });
        let c = P::from(Plane {
            a: -0.5,
            b: 0.4,
            c: 4.9,
        });
        let x = a.minus(&b);
        let y = b.minus(&c);
        let den = &x.a * &y.b - &x.b * &y.a;
        let q = Q {
            x: (&x.b * &y.c - &x.c * &y.b) / &den,
            y: (&x.c * &y.a - &x.a * &y.c) / den,
        };
        assert!(x.value(&q).is_zero());
        assert!(y.value(&q).is_zero());
        assert!(a.minus(&c).value(&q).is_zero());
    }
    fn source(points: Vec<Point>, id: usize, plane: Plane) -> Candidate {
        let domain = vec![Polygon {
            outer: points,
            holes: vec![],
        }];
        Candidate {
            domain: domain.clone(),
            plane,
            body_id: format!("body-{id}"),
            feature_id: None,
            floor_z_m: 0.0,
            envelope: Envelope::Walled,
            component_id: None,
            level: 0,
            rf: "RF-HIP".into(),
            group: format!("group-{id}"),
            layer: "main".into(),
            material: "MAT-WOOD".into(),
            kind: RoofFaceKind::Pan,
            corbel: false,
            nested: false,
            boundary_triangulation: true,
            whole_boundary: false,
            overlay_error_m: 0.0,
            material_contours: Rc::new(vec![]),
            plan_id: id,
            creation_planes: Rc::new(vec![]),
            native_anchor: None,
            native_minimum: Rc::new(vec![]),
            native_peers: Rc::new(vec![]),
            native_domain: Some(Rc::new(NativeDomain {
                base: Rc::new(NativeBase {
                    eaves: domain,
                    eaves_recipe: None,
                    cores_recipe: None,
                    cores: vec![],
                    declared: vec![],
                    lot: vec![],
                    excluded: vec![],
                    raw_arms: vec![],
                }),
                arm: None,
                arm_recipe: None,
                slab: None,
            })),
        }
    }
    fn rectangle(w: f64, h: f64) -> Vec<Point> {
        vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: w, y: 0.0 },
            Point { x: w, y: h },
            Point { x: 0.0, y: h },
        ]
    }
    fn mesh(candidates: Vec<Candidate>) -> RoofMesh {
        let (faces, _, _) = build(&candidates).unwrap();
        let raw = faces
            .into_iter()
            .map(|source| RawFace {
                vertices: source.domain[0]
                    .outer
                    .iter()
                    .map(|&p| Vertex3 {
                        x: p.x,
                        y: p.y,
                        z: source.plane.height(p),
                    })
                    .collect(),
                source,
            })
            .collect();
        super::super::build(raw).unwrap().0
    }
    #[test]
    fn an_adjacent_arm_supplies_only_its_exact_finite_raw_anchor() {
        let plane = Plane {
            a: -0.0,
            b: -0.6370702608074932,
            c: 15.741405216149865,
        };
        let mut candidate = source(rectangle(20.0, 20.0), 0, plane);
        let side = [Point { x: 2.0, y: 20.0 }, Point { x: 12.0, y: 20.0 }];
        let neighbor = vec![Polygon {
            outer: rectangle(20.0, 20.0),
            holes: vec![],
        }];
        Rc::make_mut(&mut Rc::make_mut(candidate.native_domain.as_mut().unwrap()).base).raw_arms =
            vec![neighbor];
        let anchor = super::super::native_anchor(&candidate, plane, side, 3.0).unwrap();
        assert!(anchor.edge.iter().all(|p| p.y == 20.0));
        assert_eq!(anchor.z, 3.0);
        let beyond = [Point { x: 21.0, y: 20.0 }, Point { x: 22.0, y: 20.0 }];
        assert!(super::super::native_anchor(&candidate, plane, beyond, 3.0).is_none());
        for polygon in
            &mut Rc::make_mut(&mut Rc::make_mut(candidate.native_domain.as_mut().unwrap()).base)
                .raw_arms[0]
        {
            for p in &mut polygon.outer {
                p.y += 4.8e-9;
            }
        }
        assert!(super::super::native_anchor(&candidate, plane, side, 3.0).is_none());
    }
    #[test]
    fn signed_zero_in_coplanar_arms_cannot_create_an_internal_facet() {
        let first = source(
            rectangle(4.0, 3.0),
            0,
            Plane {
                a: 0.5,
                b: 0.0,
                c: 3.0,
            },
        );
        let mut second = first.clone();
        second.plan_id = 1;
        second.plane.b = -0.0;
        let expected = mesh(vec![first.clone()]);
        assert_eq!(expected, mesh(vec![first, second]));
    }
    #[test]
    fn two_native_eaves_4_8_nanometers_apart_keep_the_positive_band() {
        let input = vec![
            source(
                rectangle(24.0, 24.0),
                0,
                Plane {
                    a: 0.0,
                    b: 0.0,
                    c: 3.0,
                },
            ),
            source(
                rectangle(24.0, 4.8e-9),
                1,
                Plane {
                    a: 0.0,
                    b: 0.0,
                    c: 4.0,
                },
            ),
        ];
        let (faces, groups, _) = build(&input).unwrap();
        assert_eq!(groups.len(), 2);
        let high = faces
            .iter()
            .filter(|c| c.plan_id == 1)
            .flat_map(|c| c.domain.iter())
            .map(|p| signed(&p.outer))
            .sum::<f64>();
        assert_eq!(high, 24.0 * 4.8e-9);
        let mesh = mesh(input);
        assert!(mesh.vertices.iter().any(|p| p.y == 4.8e-9));
        assert!(mesh.faces.iter().all(|f| f.normal[2] > 0.0));
    }
    #[test]
    fn a_false_material_triple_ten_nanometers_apart_exports_its_fine_facet() {
        let triangle = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 1e-8, y: 0.0 },
            Point { x: 0.0, y: 1e-8 },
        ];
        let mesh = mesh(vec![source(
            triangle.clone(),
            0,
            Plane {
                a: 0.0,
                b: 0.0,
                c: 3.0,
            },
        )]);
        assert_eq!(mesh.faces.len(), 1);
        assert_eq!(mesh.vertices.len(), 3);
        for p in triangle {
            assert!(mesh.vertices.iter().any(|v| v.x == p.x && v.y == p.y));
        }
    }
    #[test]
    fn three_planes_share_one_canonical_intersection() {
        let square = vec![
            Point { x: -1.0, y: -1.0 },
            Point { x: 1.0, y: -1.0 },
            Point { x: 1.0, y: 1.0 },
            Point { x: -1.0, y: 1.0 },
        ];
        let mesh = mesh(vec![
            source(
                square.clone(),
                0,
                Plane {
                    a: 1.0,
                    b: 0.0,
                    c: 3.0,
                },
            ),
            source(
                square.clone(),
                1,
                Plane {
                    a: 0.0,
                    b: 1.0,
                    c: 3.0,
                },
            ),
            source(
                square,
                2,
                Plane {
                    a: -1.0,
                    b: -1.0,
                    c: 3.0,
                },
            ),
        ]);
        assert_eq!(
            mesh.vertices
                .iter()
                .filter(|v| v.x == 0.0 && v.y == 0.0)
                .count(),
            1
        );
        assert!(mesh.faces.iter().all(|f| f.normal[2] > 0.0));
    }
}
