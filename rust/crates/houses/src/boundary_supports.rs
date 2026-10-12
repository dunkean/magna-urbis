//! Finite input-edge provenance and symbolic subdivisions of Slice edges.
use super::*;

#[derive(Clone, Debug)]
pub(super) struct Segment {
    pub owner: usize,
    pub ring: usize,
    pub edge: usize,
    pub a: Point,
    pub b: Point,
    pub error: f64,
}
pub(super) struct Supports {
    pub segments: Vec<Segment>,
    pub parents: Vec<usize>,
    pub edges: BTreeMap<(usize, usize), Option<usize>>,
    pub carriers: Vec<BTreeSet<usize>>,
    pub classes: Vec<BTreeSet<usize>>,
}
fn root(parents: &[usize], mut i: usize) -> usize {
    while parents[i] != i {
        i = parents[i];
    }
    i
}
fn key(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}
fn carries(s: &Segment, a: Point, b: Point) -> bool {
    let l = length(s.a, s.b);
    if l == 0.0 {
        return false;
    }
    [a, b].iter().all(|&p| {
        let t = parameter(p, s.a, s.b);
        distance_to_segment(p, s.a, s.b) <= s.error && t >= -s.error / l && t <= 1.0 + s.error / l
    })
}
fn consistent(a: &Segment, b: &Segment) -> bool {
    let l = length(a.a, a.b);
    if l == 0.0 {
        return false;
    }
    let t = parameter(b.a, a.a, a.b);
    let u = parameter(b.b, a.a, a.b);
    let lo = t.min(u).max(0.0);
    let hi = t.max(u).min(1.0);
    let delta = a.error + b.error;
    if (hi - lo) * l <= 2.0 * delta {
        return false;
    }
    [lo, hi].iter().all(|&v| {
        let p = Point {
            x: a.a.x + v * (a.b.x - a.a.x),
            y: a.a.y + v * (a.b.y - a.a.y),
        };
        distance_to_segment(p, b.a, b.b) <= delta
    })
}
fn meaningful_overlap(a: &Segment, b: &Segment) -> bool {
    let t = parameter(b.a, a.a, a.b);
    let u = parameter(b.b, a.a, a.b);
    (t.max(u).min(1.0) - t.min(u).max(0.0)) * length(a.a, a.b) > 2.0 * (a.error + b.error)
}

impl Supports {
    pub(super) fn build(
        points: &[Point],
        shapes: &[Vec<Vec<usize>>],
        domains: &[Surface],
        faces: &[RawFace],
        error: f64,
    ) -> Result<Self, String> {
        let mut segments = vec![];
        for (owner, domain) in domains.iter().enumerate() {
            for (ring, r) in rings(domain).enumerate() {
                for (edge, (&a, &b)) in r
                    .iter()
                    .zip(r.iter().cycle().skip(1))
                    .take(r.len())
                    .enumerate()
                {
                    segments.push(Segment {
                        owner,
                        ring,
                        edge,
                        a,
                        b,
                        error: error + faces[owner].source.overlay_error_m,
                    });
                }
            }
        }
        let mut order: Vec<_> = (0..segments.len()).collect();
        order.sort_by(|&a, &b| {
            segments[a]
                .a
                .x
                .min(segments[a].b.x)
                .total_cmp(&segments[b].a.x.min(segments[b].b.x))
                .then(a.cmp(&b))
        });
        let max_error = segments.iter().map(|s| s.error).fold(0.0, f64::max);
        let mut edge_carriers = BTreeMap::<(usize, usize), Vec<usize>>::new();
        for path in shapes.iter().flatten() {
            for (&a, &b) in path
                .iter()
                .zip(path.iter().cycle().skip(1))
                .take(path.len())
            {
                edge_carriers.entry(key(a, b)).or_insert_with(|| {
                    let p = points[a];
                    let q = points[b];
                    order
                        .iter()
                        .take_while(|&&i| {
                            segments[i].a.x.min(segments[i].b.x) <= p.x.max(q.x) + max_error
                        })
                        .copied()
                        .filter(|&i| {
                            let s = &segments[i];
                            s.a.x.max(s.b.x) >= p.x.min(q.x) - max_error
                                && s.a.y.max(s.b.y) >= p.y.min(q.y) - max_error
                                && s.a.y.min(s.b.y) <= p.y.max(q.y) + max_error
                                && carries(s, p, q)
                        })
                        .collect()
                });
            }
        }
        let mut parents: Vec<_> = (0..segments.len()).collect();
        let mut members: Vec<_> = (0..segments.len()).map(|i| BTreeSet::from([i])).collect();
        for (&(a, b), ids) in &edge_carriers {
            let delta = ids.iter().map(|&i| segments[i].error).fold(0.0, f64::max);
            // A raster-sized edge cannot prove two material supports identical.
            if length(points[a], points[b]) <= 2.0 * delta {
                continue;
            }
            for (position, &i) in ids.iter().enumerate() {
                for &j in &ids[position + 1..] {
                    if length(points[a], points[b]) <= 2.0 * (segments[i].error + segments[j].error)
                    {
                        continue;
                    }
                    if !consistent(&segments[i], &segments[j])
                        || !consistent(&segments[j], &segments[i])
                    {
                        continue;
                    }
                    let x = root(&parents, i);
                    let y = root(&parents, j);
                    if x == y {
                        continue;
                    }
                    let coherent = members[x].iter().all(|&u| {
                        members[y].iter().all(|&v| {
                            !meaningful_overlap(&segments[u], &segments[v])
                                || (consistent(&segments[u], &segments[v])
                                    && consistent(&segments[v], &segments[u]))
                        })
                    });
                    if !coherent {
                        continue;
                    }
                    let moved = std::mem::take(&mut members[x.max(y)]);
                    members[x.min(y)].extend(moved);
                    parents[x.max(y)] = x.min(y);
                }
            }
        }
        for i in 0..parents.len() {
            parents[i] = root(&parents, i);
        }
        for (i, s) in segments.iter().enumerate() {
            let representative = &segments[parents[i]];
            let a = parameter(s.a, representative.a, representative.b);
            let b = parameter(s.b, representative.a, representative.b);
            let overlap = (a.max(b).min(1.0) - a.min(b).max(0.0))
                * length(representative.a, representative.b)
                > 2.0 * (s.error + representative.error);
            if parents[i] != i
                && overlap
                && (!consistent(s, representative) || !consistent(representative, s))
            {
                return Err(format!(
                    "Classe de support Boundary incohérente : segments {i}/{} : {:?} et {:?}.",
                    parents[i], s, representative
                ));
            }
        }
        let mut carriers = vec![BTreeSet::new(); points.len()];
        let mut classes = vec![BTreeSet::new(); points.len()];
        let mut edges = BTreeMap::new();
        for (edge, ids) in edge_carriers {
            for &i in &ids {
                carriers[edge.0].insert(i);
                carriers[edge.1].insert(i);
            }
            let roots: BTreeSet<_> = ids.iter().map(|&i| parents[i]).collect();
            let class = (roots.len() == 1).then(|| *roots.first().unwrap());
            if let Some(class) = class {
                classes[edge.0].insert(class);
                classes[edge.1].insert(class);
            }
            edges.insert(edge, class);
        }
        Ok(Self {
            segments,
            parents,
            edges,
            carriers,
            classes,
        })
    }
    pub(super) fn local_segments(&self, id: usize) -> Vec<(Point, Point)> {
        let mut ids: Vec<_> = self.classes[id].iter().copied().collect();
        ids.extend(self.carriers[id].iter().copied());
        ids.sort_unstable();
        ids.dedup();
        ids.into_iter()
            .map(|i| {
                let s = &self.segments[i];
                (s.a, s.b)
            })
            .collect()
    }
    pub(super) fn one_class_target(&self, id: usize, p: Point) -> Option<Point> {
        if self.classes[id].len() != 1 {
            return None;
        }
        let class = *self.classes[id].first().unwrap();
        // Keep the smallest class id, but do not extrapolate a short raster
        // segment beyond its finite certified interval.
        let segment = self.carriers[id]
            .iter()
            .copied()
            .filter(|&i| self.parents[i] == class)
            .min_by(|&i, &j| {
                distance_to_segment(p, self.segments[i].a, self.segments[i].b)
                    .total_cmp(&distance_to_segment(
                        p,
                        self.segments[j].a,
                        self.segments[j].b,
                    ))
                    .then(i.cmp(&j))
            })?;
        let s = &self.segments[segment];
        let t = parameter(p, s.a, s.b);
        Some(Point {
            x: s.a.x + t * (s.b.x - s.a.x),
            y: s.a.y + t * (s.b.y - s.a.y),
        })
    }
    pub(super) fn subdivide(
        &self,
        path: &[usize],
        targets: &[Point],
        roots: &[usize],
    ) -> Result<Vec<usize>, String> {
        let mut out = vec![];
        for (&a, &b) in path
            .iter()
            .zip(path.iter().cycle().skip(1))
            .take(path.len())
        {
            if roots[a] == roots[b] {
                continue;
            }
            let Some(class) = self.edges.get(&key(a, b)).copied().flatten() else {
                out.push(roots[a]);
                continue;
            };
            let s = &self.segments[class];
            let t = parameter(targets[a], s.a, s.b);
            let u = parameter(targets[b], s.a, s.b);
            let mut cuts: Vec<_> = self
                .classes
                .iter()
                .enumerate()
                .filter_map(|(id, classes)| {
                    if !classes.contains(&class) {
                        return None;
                    }
                    let v = parameter(targets[id], s.a, s.b);
                    (v >= t.min(u) && v <= t.max(u)).then_some((v, roots[id]))
                })
                .collect();
            cuts.push((t, roots[a]));
            cuts.push((u, roots[b]));
            cuts.sort_by(|(v, i), (w, j)| v.total_cmp(w).then(i.cmp(j)));
            cuts.dedup();
            for pair in cuts.windows(2) {
                if pair[0].0 == pair[1].0 && pair[0].1 != pair[1].1 {
                    return Err("Deux nœuds Boundary distincts à même paramètre de support.".into());
                }
            }
            if t > u {
                cuts.reverse();
            }
            cuts.pop();
            out.extend(cuts.into_iter().map(|(_, id)| id));
        }
        out.dedup();
        if out.first() == out.last() {
            out.pop();
        }
        Ok(out)
    }
}
