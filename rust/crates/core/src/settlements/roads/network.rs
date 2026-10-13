//! One road network from all routed paths.
//!
//! Every routed path adds its moves to a single graph whose vertices are grid cells (pinned
//! to the exact settlement or map-exit point), so a stretch used by several routes exists once.
//! Moves that cross without sharing a cell get a junction at their intersection; tiny triangles
//! left where a route joins at an angle lose their longest side. Chains of degree-2 vertices
//! become links between junctions, which carry the class of the most important trip routed over
//! them on the final network.
use super::super::Point;
use super::super::grid::{Entry, Fields};
use std::collections::{BTreeMap, BinaryHeap, HashMap};

pub(super) struct Routed {
    pub cells: Vec<usize>,
    pub importance: u32,
    pub profile: usize,
    /// Exact start point (settlement centre or map exit) and its label.
    pub start: (Point, String),
    /// Exact end point when the path reaches the target centre rather than a road.
    pub end: Option<(Point, String)>,
}

#[derive(Clone)]
struct Edge {
    a: usize,
    b: usize,
    importance: u32,
    profile: usize,
    alive: bool,
}

pub(super) struct Link {
    pub vertices: Vec<usize>,
    pub importance: u32,
    pub profile: usize,
    pub length: f64,
}

pub(super) struct Graph {
    pub pos: Vec<Point>,
    pub cell: Vec<Option<usize>>,
    pub pin: Vec<Option<String>>,
    edges: Vec<Edge>,
    by_cell: HashMap<usize, usize>,
    by_pair: HashMap<(usize, usize), usize>,
}

impl Graph {
    pub fn new() -> Self {
        Self {
            pos: vec![],
            cell: vec![],
            pin: vec![],
            edges: vec![],
            by_cell: HashMap::new(),
            by_pair: HashMap::new(),
        }
    }
    fn vertex(&mut self, f: &Fields, cell: usize) -> usize {
        if let Some(&v) = self.by_cell.get(&cell) {
            return v;
        }
        let v = self.pos.len();
        self.pos.push(f.pos(cell));
        self.cell.push(Some(cell));
        self.pin.push(None);
        self.by_cell.insert(cell, v);
        v
    }
    fn pin_vertex(&mut self, v: usize, p: Point, label: &str) {
        if self.pin[v].is_none() {
            self.pin[v] = Some(label.to_string());
            self.pos[v] = p;
        }
    }
    fn edge(&mut self, a: usize, b: usize, importance: u32, profile: usize) {
        if a == b {
            return;
        }
        let key = (a.min(b), a.max(b));
        if let Some(&e) = self.by_pair.get(&key) {
            let edge = &mut self.edges[e];
            if importance > edge.importance {
                edge.importance = importance;
                edge.profile = profile;
            }
            return;
        }
        self.by_pair.insert(key, self.edges.len());
        self.edges.push(Edge {
            a,
            b,
            importance,
            profile,
            alive: true,
        });
    }
    pub fn add(&mut self, f: &Fields, r: &Routed) {
        let vs: Vec<_> = r.cells.iter().map(|&c| self.vertex(f, c)).collect();
        self.pin_vertex(vs[0], r.start.0, &r.start.1);
        if let Some((p, label)) = &r.end {
            self.pin_vertex(*vs.last().unwrap(), *p, label);
        }
        for w in vs.windows(2) {
            self.edge(w[0], w[1], r.importance, r.profile);
        }
    }
    /// Pins a settlement onto the vertex of its cell when a road passes through it.
    pub fn pin_cell(&mut self, cell: usize, p: Point, label: &str) {
        if let Some(&v) = self.by_cell.get(&cell) {
            self.pin_vertex(v, p, label);
        }
    }
    pub fn vertex_of(&self, cell: usize) -> Option<usize> {
        self.by_cell.get(&cell).copied()
    }

    /// Splits moves that cross without a shared vertex at their intersection.
    pub fn planarize(&mut self, f: &Fields) {
        let n = f.r.n;
        let mut buckets: HashMap<usize, Vec<usize>> = HashMap::new();
        for (e, edge) in self.edges.iter().enumerate() {
            let (a, b) = (self.pos[edge.a], self.pos[edge.b]);
            let x0 = (a.x.min(b.x) / f.cell).floor().max(0.0) as usize;
            let x1 = ((a.x.max(b.x) / f.cell).floor() as usize).min(n - 1);
            let y0 = (a.y.min(b.y) / f.cell).floor().max(0.0) as usize;
            let y1 = ((a.y.max(b.y) / f.cell).floor() as usize).min(n - 1);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    buckets.entry(y * n + x).or_default().push(e);
                }
            }
        }
        let mut cuts: BTreeMap<(usize, usize), Point> = BTreeMap::new();
        let mut keys: Vec<_> = buckets.keys().copied().collect();
        keys.sort_unstable();
        for k in keys {
            let list = &buckets[&k];
            for (u, &e1) in list.iter().enumerate() {
                for &e2 in &list[u + 1..] {
                    let (p, q) = (&self.edges[e1], &self.edges[e2]);
                    if p.a == q.a || p.a == q.b || p.b == q.a || p.b == q.b {
                        continue;
                    }
                    let key = (e1.min(e2), e1.max(e2));
                    if cuts.contains_key(&key) {
                        continue;
                    }
                    if let Some(x) =
                        intersect(self.pos[p.a], self.pos[p.b], self.pos[q.a], self.pos[q.b])
                    {
                        cuts.insert(key, x);
                    }
                }
            }
        }
        let mut splits: BTreeMap<usize, Vec<(f64, usize)>> = BTreeMap::new();
        for ((e1, e2), x) in cuts {
            let v = self.pos.len();
            self.pos.push(x);
            self.cell.push(None);
            self.pin.push(None);
            for e in [e1, e2] {
                let (a, b) = (self.pos[self.edges[e].a], self.pos[self.edges[e].b]);
                splits
                    .entry(e)
                    .or_default()
                    .push((a.distance(x) / a.distance(b).max(1e-9), v));
            }
        }
        for (e, mut points) in splits {
            points.sort_by(|a, b| a.0.total_cmp(&b.0));
            let old = self.edges[e].clone();
            self.edges[e].alive = false;
            self.by_pair.remove(&(old.a.min(old.b), old.a.max(old.b)));
            let mut prev = old.a;
            for (_, v) in points {
                self.edge(prev, v, old.importance, old.profile);
                prev = v;
            }
            self.edge(prev, old.b, old.importance, old.profile);
        }
    }

    fn adjacency(&self) -> Vec<Vec<(usize, usize)>> {
        let mut adj = vec![vec![]; self.pos.len()];
        for (e, edge) in self.edges.iter().enumerate() {
            if edge.alive {
                adj[edge.a].push((edge.b, e));
                adj[edge.b].push((edge.a, e));
            }
        }
        adj
    }

    /// Removes the longest side of short triangles (a route joining a road at a shallow angle
    /// touches two consecutive road vertices). Connectivity is unchanged by construction.
    pub fn drop_triangles(&mut self, f: &Fields) {
        let limit = 3.3 * f.cell;
        let adj = self.adjacency();
        for around in &adj {
            for (x, &(a, ea)) in around.iter().enumerate() {
                for &(b, eb) in &around[x + 1..] {
                    let Some(&ab) = self.by_pair.get(&(a.min(b), a.max(b))) else {
                        continue;
                    };
                    let tri = [ea, eb, ab];
                    if tri.iter().any(|&e| !self.edges[e].alive) {
                        continue;
                    }
                    let len =
                        |e: usize| self.pos[self.edges[e].a].distance(self.pos[self.edges[e].b]);
                    if tri.iter().any(|&e| len(e) > limit) {
                        continue;
                    }
                    let longest = *tri
                        .iter()
                        .max_by(|&&p, &&q| len(p).total_cmp(&len(q)))
                        .unwrap();
                    let lost = self.edges[longest].clone();
                    self.edges[longest].alive = false;
                    self.by_pair
                        .remove(&(lost.a.min(lost.b), lost.a.max(lost.b)));
                    for e in tri {
                        if e != longest && lost.importance > self.edges[e].importance {
                            self.edges[e].importance = lost.importance;
                            self.edges[e].profile = lost.profile;
                        }
                    }
                }
            }
        }
    }

    /// Chains between junctions (degree ≠ 2), pinned points and dead ends.
    pub fn links(&self) -> Vec<Link> {
        let adj = self.adjacency();
        let node = |v: usize| adj[v].len() != 2 || self.pin[v].is_some();
        let mut used = vec![false; self.edges.len()];
        let mut links = vec![];
        let walk = |start: usize, first: (usize, usize), used: &mut Vec<bool>| {
            let mut vertices = vec![start];
            let (mut at, mut e) = first;
            let mut importance = 0;
            let mut profile = 0;
            loop {
                used[e] = true;
                if self.edges[e].importance >= importance {
                    importance = self.edges[e].importance;
                    profile = self.edges[e].profile;
                }
                vertices.push(at);
                if node(at) || at == start {
                    break;
                }
                let Some(&next) = adj[at].iter().find(|&&(_, x)| !used[x]) else {
                    break;
                };
                e = next.1;
                at = next.0;
            }
            let length = vertices
                .windows(2)
                .map(|w| self.pos[w[0]].distance(self.pos[w[1]]))
                .sum();
            Link {
                vertices,
                importance,
                profile,
                length,
            }
        };
        for (v, around) in adj.iter().enumerate() {
            if !node(v) {
                continue;
            }
            for &(w, e) in around {
                if !used[e] {
                    links.push(walk(v, (w, e), &mut used));
                }
            }
        }
        // Closed loops with no junction at all.
        for (v, around) in adj.iter().enumerate() {
            if let Some(&(w, e)) = around.iter().find(|&&(_, e)| !used[e]) {
                links.push(walk(v, (w, e), &mut used));
            }
        }
        links
    }
}

fn intersect(a: Point, b: Point, c: Point, d: Point) -> Option<Point> {
    let r = (b.x - a.x, b.y - a.y);
    let s = (d.x - c.x, d.y - c.y);
    let den = r.0 * s.1 - r.1 * s.0;
    if den.abs() < 1e-12 {
        return None;
    }
    let t = ((c.x - a.x) * s.1 - (c.y - a.y) * s.0) / den;
    let u = ((c.x - a.x) * r.1 - (c.y - a.y) * r.0) / den;
    let eps = 1e-6;
    (t > eps && t < 1.0 - eps && u > eps && u < 1.0 - eps).then_some(Point {
        x: a.x + t * r.0,
        y: a.y + t * r.1,
    })
}

/// Raises each link to the importance of the trips whose shortest network path uses it.
/// Trips detouring more than `max_detour` × the straight distance are ignored.
pub(super) fn assign_traffic(
    links: &mut [Link],
    vertex_count: usize,
    pos: &[Point],
    trips: &[(usize, usize, u32)],
    max_detour: f64,
) {
    let mut adj = vec![vec![]; vertex_count];
    for (l, link) in links.iter().enumerate() {
        let (a, b) = (link.vertices[0], *link.vertices.last().unwrap());
        adj[a].push((b, l));
        adj[b].push((a, l));
    }
    let mut by_source: BTreeMap<usize, Vec<(usize, u32)>> = BTreeMap::new();
    for &(a, b, w) in trips {
        by_source.entry(a).or_default().push((b, w));
    }
    let mut dist = vec![f64::INFINITY; vertex_count];
    let mut via = vec![usize::MAX; vertex_count];
    let mut touched = vec![];
    let mut raise = vec![0_u32; links.len()];
    for (source, targets) in by_source {
        for &v in &touched {
            dist[v] = f64::INFINITY;
            via[v] = usize::MAX;
        }
        touched.clear();
        dist[source] = 0.0;
        touched.push(source);
        let mut heap = BinaryHeap::new();
        heap.push(Entry(0.0, source));
        let reach = targets
            .iter()
            .map(|&(t, _)| pos[source].distance(pos[t]) * max_detour)
            .fold(0.0, f64::max);
        while let Some(Entry(d, v)) = heap.pop() {
            if d > dist[v] || d > reach {
                continue;
            }
            for &(w, l) in &adj[v] {
                let nd = d + links[l].length;
                if nd < dist[w] {
                    if !dist[w].is_finite() {
                        touched.push(w);
                    }
                    dist[w] = nd;
                    via[w] = l;
                    heap.push(Entry(nd, w));
                }
            }
        }
        for (target, weight) in targets {
            if !dist[target].is_finite()
                || dist[target] > max_detour * pos[source].distance(pos[target]).max(1.0)
            {
                continue;
            }
            let mut at = target;
            while at != source {
                let l = via[at];
                raise[l] = raise[l].max(weight);
                let link = &links[l];
                at = if link.vertices[0] == at {
                    *link.vertices.last().unwrap()
                } else {
                    link.vertices[0]
                };
            }
        }
    }
    for (link, r) in links.iter_mut().zip(raise) {
        link.importance = link.importance.max(r);
    }
}
