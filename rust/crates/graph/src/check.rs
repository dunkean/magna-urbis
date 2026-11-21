//! Structural invariants, checked on demand.

use std::collections::HashMap;

use magna_urbis_geom::signed;

use super::index::{Contact, bbox, contacts};
use super::insert::{SNAP, check_simple};
use super::{EdgeId, FaceId, Graph, HalfId, Key, Level, Life, NodeId};

/// Area below which an inner walk counts as clockwise or flat (square metres).
const FLAT: f64 = 1e-6;

impl Graph {
    /// Every violated invariant, one line each; empty when the graph is sound. Checks keys,
    /// dates and parents, half-edge links and angular order, closed walks and face
    /// representatives, Euler's relation per level and per connected component, and that no two
    /// live edges of one level touch away from shared nodes.
    pub fn check_invariants(&self) -> Vec<String> {
        let mut out = Vec::new();
        self.check_keys(&mut out);
        self.check_history(&mut out);
        self.check_links(&mut out);
        for level in Level::ALL {
            self.check_level(level, &mut out);
        }
        self.check_crossings(&mut out);
        out
    }

    fn check_keys(&self, out: &mut Vec<String>) {
        for (i, n) in self.nodes.iter().enumerate() {
            if self.node_keys.get(&n.key) != Some(&NodeId(i as u32)) {
                out.push(format!("node {i} is not reached from its key {:?}", n.key));
            }
        }
        for (i, e) in self.edges.iter().enumerate() {
            if self.edge_keys.get(&e.key) != Some(&EdgeId(i as u32)) {
                out.push(format!("edge {i} is not reached from its key {:?}", e.key));
            }
        }
        for (i, f) in self.faces.iter().enumerate() {
            if self.face_keys.get(&f.key) != Some(&FaceId(i as u32)) {
                out.push(format!("face {i} is not reached from its key {:?}", f.key));
            }
        }
        let counts = [
            (self.node_keys.len(), self.nodes.len()),
            (self.edge_keys.len(), self.edges.len()),
            (self.face_keys.len(), self.faces.len()),
        ];
        for (table, (keys, elements)) in ["node", "edge", "face"].into_iter().zip(counts) {
            if keys != elements {
                out.push(format!("{keys} {table} keys for {elements} {table}s"));
            }
        }
    }

    fn check_history(&self, out: &mut Vec<String>) {
        for (i, n) in self.nodes.iter().enumerate() {
            check_life(out, "node", i, &n.life, |k| {
                self.node_keys
                    .get(k)
                    .map(|p| (&self.nodes[p.ix()].life, false))
            });
        }
        for (i, e) in self.edges.iter().enumerate() {
            check_life(out, "edge", i, &e.life, |k| {
                self.edge_keys
                    .get(k)
                    .map(|p| (&self.edges[p.ix()].life, false))
            });
        }
        for (i, f) in self.faces.iter().enumerate() {
            check_life(out, "face", i, &f.life, |k| {
                self.face_keys
                    .get(k)
                    .map(|p| (&self.faces[p.ix()].life, self.outside.contains(p)))
            });
        }
        for level in Level::ALL {
            if !self.faces[self.outside(level).ix()].life.live() {
                out.push(format!("unbounded face of {level:?} is retired"));
            }
        }
    }

    fn check_links(&self, out: &mut Vec<String>) {
        for (i, node) in self.nodes.iter().enumerate() {
            if !node.life.live() && !node.out.is_empty() {
                out.push(format!("retired node {i} keeps arms"));
            }
            for &h in &node.out {
                if !self.edges[h.edge().ix()].life.live() {
                    out.push(format!("node {i} lists the retired half {}", h.0));
                }
                if self.halves[h.ix()].origin.ix() != i {
                    out.push(format!(
                        "node {i} lists half {} that leaves another node",
                        h.0
                    ));
                }
            }
        }
        for e in self.live_edges() {
            let edge = &self.edges[e.ix()];
            let p = &edge.polyline;
            if p.len() < 2 || edge.widths.len() != p.len() {
                out.push(format!(
                    "edge {} has {} points and {} widths",
                    e.0,
                    p.len(),
                    edge.widths.len()
                ));
                continue;
            }
            for (k, h) in [HalfId::forward(e), HalfId::backward(e)]
                .into_iter()
                .enumerate()
            {
                let node = edge.nodes[k];
                let end = if k == 0 { p[0] } else { p[p.len() - 1] };
                if !self.nodes[node.ix()].life.live() {
                    out.push(format!("edge {} ends on the retired node {}", e.0, node.0));
                }
                if self.nodes[node.ix()].position.distance(end) > SNAP {
                    out.push(format!("edge {} does not end at node {}", e.0, node.0));
                }
                if !self.nodes[node.ix()].out.contains(&h) {
                    out.push(format!("node {} does not list half {}", node.0, h.0));
                }
                let half = &self.halves[h.ix()];
                let next = half.next;
                if half.origin != node {
                    out.push(format!("half {} does not leave node {}", h.0, node.0));
                }
                if !self.edges[next.edge().ix()].life.live() {
                    out.push(format!("half {} is followed by a retired half", h.0));
                    continue;
                }
                if self.halves[next.ix()].prev != h {
                    out.push(format!("half {} is not the previous of its next", h.0));
                }
                if self.halves[next.ix()].origin != self.halves[h.twin().ix()].origin {
                    out.push(format!("half {} is not followed from its end", h.0));
                }
                if self.halves[next.ix()].face != half.face {
                    out.push(format!("half {} and its next lie in different faces", h.0));
                }
                if self.edges[next.edge().ix()].level != edge.level {
                    out.push(format!("half {} is followed on another level", h.0));
                }
                let face = &self.faces[half.face.ix()];
                if !face.life.live() || face.level != edge.level {
                    out.push(format!(
                        "half {} lies in a retired face or one of another level",
                        h.0
                    ));
                }
            }
        }
        for n in self.live_nodes() {
            for level in Level::ALL {
                let arms = self.arms(n, level);
                let k = arms.len();
                for i in 0..k {
                    if self.halves[arms[i].twin().ix()].next != arms[(i + k - 1) % k] {
                        out.push(format!(
                            "node {} on {level:?}: walks out of angular order",
                            n.0
                        ));
                        break;
                    }
                }
            }
        }
    }

    fn check_level(&self, level: Level, out: &mut Vec<String>) {
        let edges: Vec<EdgeId> = self
            .live_edges()
            .filter(|e| self.edges[e.ix()].level == level)
            .collect();
        // Walks.
        let mut walk_of: HashMap<HalfId, usize> = HashMap::new();
        let mut walks: Vec<Vec<HalfId>> = Vec::new();
        for &e in &edges {
            for h in [HalfId::forward(e), HalfId::backward(e)] {
                if walk_of.contains_key(&h) {
                    continue;
                }
                let walk = self.trace(h);
                if self.halves[walk[walk.len() - 1].ix()].next != h {
                    out.push(format!("walk from half {} does not close", h.0));
                    continue;
                }
                for &x in &walk {
                    if walk_of.insert(x, walks.len()).is_some() {
                        out.push(format!("half {} lies on two walks", x.0));
                    }
                }
                walks.push(walk);
            }
        }
        // Faces and their representatives.
        let mut walks_per_face: HashMap<FaceId, usize> = HashMap::new();
        for walk in &walks {
            *walks_per_face
                .entry(self.halves[walk[0].ix()].face)
                .or_default() += 1;
        }
        let faces: Vec<FaceId> = self
            .live_faces()
            .filter(|f| self.faces[f.ix()].level == level)
            .collect();
        for &f in &faces {
            let face = &self.faces[f.ix()];
            let unbounded = f == self.outside(level);
            if unbounded != face.outer.is_none() {
                out.push(format!("face {} has the wrong kind of outer walk", f.0));
            }
            let reps = self.cycles(f);
            let mut seen = Vec::new();
            for (k, &r) in reps.iter().enumerate() {
                let Some(&w) = walk_of.get(&r) else {
                    out.push(format!(
                        "face {} has a representative off every live walk",
                        f.0
                    ));
                    continue;
                };
                if self.halves[r.ix()].face != f {
                    out.push(format!("face {} has a representative in another face", f.0));
                }
                if seen.contains(&w) {
                    out.push(format!("face {} has two representatives on one walk", f.0));
                }
                seen.push(w);
                let area = signed(&self.ring(&walks[w]));
                let outer = k == 0 && !unbounded;
                if outer && area <= FLAT {
                    out.push(format!(
                        "face {} has an outer walk that is not counter-clockwise",
                        f.0
                    ));
                }
                if !outer && area > FLAT {
                    out.push(format!(
                        "face {} has an inner walk that is counter-clockwise",
                        f.0
                    ));
                }
            }
            if walks_per_face.get(&f).copied().unwrap_or(0) != reps.len() {
                out.push(format!(
                    "face {} has {} representatives for {} walks",
                    f.0,
                    reps.len(),
                    walks_per_face.get(&f).copied().unwrap_or(0)
                ));
            }
        }
        // Euler's relation: V - E + F = 1 + C on the level, V - E + max(W, 1) = 2 per component.
        let mut vertex: HashMap<NodeId, usize> = HashMap::new();
        for n in self.live_nodes() {
            if self.nodes[n.ix()].level == level || !self.arms(n, level).is_empty() {
                let k = vertex.len();
                vertex.insert(n, k);
            }
        }
        let mut parent: Vec<usize> = (0..vertex.len()).collect();
        fn root(parent: &mut [usize], mut x: usize) -> usize {
            while parent[x] != x {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            x
        }
        for &e in &edges {
            let [a, b] = self.edges[e.ix()].nodes;
            let (Some(&a), Some(&b)) = (vertex.get(&a), vertex.get(&b)) else {
                continue;
            };
            let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
            parent[ra] = rb;
        }
        let mut per_root: HashMap<usize, [i64; 3]> = HashMap::new();
        for k in 0..vertex.len() {
            per_root.entry(root(&mut parent, k)).or_default()[0] += 1;
        }
        for &e in &edges {
            if let Some(&a) = vertex.get(&self.edges[e.ix()].nodes[0]) {
                per_root.entry(root(&mut parent, a)).or_default()[1] += 1;
            }
        }
        for walk in &walks {
            if let Some(&a) = vertex.get(&self.halves[walk[0].ix()].origin) {
                per_root.entry(root(&mut parent, a)).or_default()[2] += 1;
            }
        }
        let (v, e, f, c) = (
            vertex.len() as i64,
            edges.len() as i64,
            faces.len() as i64,
            per_root.len() as i64,
        );
        if v - e + f != 1 + c {
            out.push(format!(
                "{level:?}: Euler's relation fails, V {v} - E {e} + F {f} != 1 + C {c}"
            ));
        }
        let mut components: Vec<[i64; 3]> = per_root.into_values().collect();
        components.sort_unstable();
        for [cv, ce, cw] in components {
            if cv - ce + cw.max(1) != 2 {
                out.push(format!(
                    "{level:?}: a component fails Euler's relation, V {cv} - E {ce} + W {cw} != 2"
                ));
            }
        }
    }

    fn check_crossings(&self, out: &mut Vec<String>) {
        for e in self.live_edges() {
            let edge = &self.edges[e.ix()];
            if check_simple(&edge.polyline).is_err() {
                out.push(format!("edge {} touches itself", e.0));
            }
            let candidates = self.index[edge.level.index()].candidates(bbox(&edge.polyline));
            if !candidates.contains(&e) {
                out.push(format!("edge {} is missing from the spatial index", e.0));
            }
            for f in candidates.into_iter().filter(|&f| f > e) {
                let other = &self.edges[f.ix()];
                if !other.life.live() {
                    out.push(format!("retired edge {} is in the spatial index", f.0));
                    continue;
                }
                for contact in contacts(&edge.polyline, &other.polyline) {
                    let shared = match contact {
                        Contact::Overlap => false,
                        Contact::Point(p) => edge.nodes.iter().any(|n| {
                            other.nodes.contains(n)
                                && self.nodes[n.ix()].position.distance(p) <= SNAP
                        }),
                    };
                    if !shared {
                        out.push(format!(
                            "edges {} and {} touch away from a shared node",
                            e.0, f.0
                        ));
                        break;
                    }
                }
            }
        }
    }
}

/// Dates in order, and each parent found, retired no later than the child's birth. An unbounded
/// face may be a parent while it stands, since it never retires.
fn check_life<'a>(
    out: &mut Vec<String>,
    what: &str,
    i: usize,
    life: &Life,
    parent: impl Fn(&Key) -> Option<(&'a Life, bool)>,
) {
    if life.died.is_some_and(|died| died < life.born) {
        out.push(format!("{what} {i} retires before it is born"));
    }
    for key in &life.parents {
        match parent(key) {
            None => out.push(format!("{what} {i} has an unknown parent {key:?}")),
            Some((_, true)) => {}
            Some((p, false)) => match p.died {
                None => out.push(format!("{what} {i} has a parent that is not retired")),
                Some(died) if died > life.born => {
                    out.push(format!("{what} {i} has a parent retired after its birth"))
                }
                Some(_) => {}
            },
        }
    }
}
