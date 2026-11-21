//! Arms in angular order, face walks, face births and outlines.

use std::collections::{HashMap, HashSet};
use std::f64::consts::TAU;

use magna_urbis_geom::{Point, Shape, signed};

use super::{
    ChainStep, Change, Clock, EdgeId, Face, FaceId, FaceKind, Graph, GraphError, HalfId, Key,
    Level, Life, NodeId, Sector, Versioned, tag,
};

/// A face about to be born.
pub(super) struct NewFace {
    /// Caller's key, or `None` to derive one from the outer walk.
    pub name: Option<Key>,
    pub level: Level,
    pub kind: FaceKind,
    pub parents: Vec<Key>,
    pub outer: HalfId,
    pub inners: Vec<HalfId>,
}

/// Direction of the segment from `a` to `b`, in radians.
pub(super) fn angle(a: Point, b: Point) -> f64 {
    (b.y - a.y).atan2(b.x - a.x)
}

/// Even-odd point-in-ring test.
pub(super) fn ring_contains(ring: &[Point], p: Point) -> bool {
    let mut inside = false;
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            inside = !inside;
        }
    }
    inside
}

impl Graph {
    /// A half's polyline in its own direction.
    pub(super) fn half_points(&self, h: HalfId) -> Vec<Point> {
        let polyline = &self.edges[h.edge().ix()].polyline;
        if h.is_forward() {
            polyline.clone()
        } else {
            polyline.iter().rev().copied().collect()
        }
    }

    /// Direction in which a half leaves its origin.
    pub(super) fn half_angle(&self, h: HalfId) -> f64 {
        let p = &self.edges[h.edge().ix()].polyline;
        let n = p.len();
        if h.is_forward() {
            angle(p[0], p[1])
        } else {
            angle(p[n - 1], p[n - 2])
        }
    }

    /// Live outgoing halves of `node` on `level`, counter-clockwise from the west.
    pub fn arms(&self, node: NodeId, level: Level) -> Vec<HalfId> {
        let mut arms: Vec<(f64, HalfId)> = self.nodes[node.ix()]
            .out
            .iter()
            .filter(|h| self.edges[h.edge().ix()].level == level)
            .map(|&h| (self.half_angle(h), h))
            .collect();
        arms.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then_with(|| {
                    self.edges[a.1.edge().ix()]
                        .key
                        .cmp(&self.edges[b.1.edge().ix()].key)
                })
                .then(a.1.cmp(&b.1))
        });
        arms.into_iter().map(|(_, h)| h).collect()
    }

    /// The sectors between consecutive arms of `node` on `level`, counter-clockwise.
    pub fn sectors(&self, node: NodeId, level: Level) -> Vec<Sector> {
        let arms = self.arms(node, level);
        (0..arms.len())
            .map(|i| {
                let (from, to) = (arms[i], arms[(i + 1) % arms.len()]);
                let mut opening = (self.half_angle(to) - self.half_angle(from)).rem_euclid(TAU);
                if opening <= 0.0 {
                    opening += TAU;
                }
                Sector {
                    from,
                    to,
                    face: self.halves[from.ix()].face,
                    opening,
                }
            })
            .collect()
    }

    /// Rebuild the walks through `node` on `level` from its arms' angular order: the walk
    /// arriving along an arm leaves along the next arm clockwise.
    pub(super) fn relink(&mut self, node: NodeId, level: Level) {
        let arms = self.arms(node, level);
        let k = arms.len();
        for i in 0..k {
            let incoming = arms[i].twin();
            let next = arms[(i + k - 1) % k];
            self.halves[incoming.ix()].next = next;
            self.halves[next.ix()].prev = incoming;
        }
    }

    /// The arm whose sector holds direction `angle` at `node`, or `None` without arms.
    pub(super) fn sector_half(&self, node: NodeId, level: Level, angle: f64) -> Option<HalfId> {
        let arms = self.arms(node, level);
        arms.iter()
            .rev()
            .find(|&&h| self.half_angle(h) < angle)
            .or(arms.last())
            .copied()
    }

    /// The walk starting at `start`, following `next`.
    pub(super) fn trace(&self, start: HalfId) -> Vec<HalfId> {
        let mut walk = vec![start];
        let mut h = self.halves[start.ix()].next;
        while h != start && walk.len() <= self.halves.len() {
            walk.push(h);
            h = self.halves[h.ix()].next;
        }
        walk
    }

    /// The closed ring of points along a walk.
    pub(super) fn ring(&self, walk: &[HalfId]) -> Vec<Point> {
        let mut ring = Vec::new();
        for &h in walk {
            let points = self.half_points(h);
            ring.extend_from_slice(&points[..points.len() - 1]);
        }
        ring
    }

    /// One half per walk of a face: the outer walk first.
    pub fn cycles(&self, face: FaceId) -> Vec<HalfId> {
        let f = &self.faces[face.ix()];
        f.outer
            .into_iter()
            .chain(f.inners.iter().copied())
            .collect()
    }

    /// The boundary walks of a face, the outer walk first; trees inside the face appear in the
    /// walk that goes round them.
    pub fn walks(&self, face: FaceId) -> Vec<Vec<HalfId>> {
        self.cycles(face)
            .into_iter()
            .map(|h| self.trace(h))
            .collect()
    }

    /// The face's representative half lying on `walk`.
    pub(super) fn rep_on(&self, face: FaceId, walk: &[HalfId]) -> Result<HalfId, GraphError> {
        let on: HashSet<HalfId> = walk.iter().copied().collect();
        self.cycles(face)
            .into_iter()
            .find(|r| on.contains(r))
            .ok_or(GraphError::Inconsistent("walk without representative"))
    }

    /// Replace a face's representative `old` by `new`.
    pub(super) fn replace_rep(&mut self, face: FaceId, old: HalfId, new: HalfId) {
        let f = &mut self.faces[face.ix()];
        if f.outer == Some(old) {
            f.outer = Some(new);
        }
        for r in &mut f.inners {
            if *r == old {
                *r = new;
            }
        }
    }

    /// Set `face` on every half of the walks through `reps`.
    pub(super) fn claim(&mut self, face: FaceId, reps: &[HalfId]) {
        for &r in reps {
            for h in self.trace(r) {
                self.halves[h.ix()].face = face;
            }
        }
    }

    /// A key for a face from the keys of the halves on its outer walk, so that the same face
    /// gets the same key whatever order its edges were inserted in. A key already held by an
    /// earlier face is salted.
    fn derived_face_key(&self, outer: HalfId) -> Key {
        let mut items: Vec<(&Key, bool)> = self
            .trace(outer)
            .into_iter()
            .map(|h| (&self.edges[h.edge().ix()].key, h.is_forward()))
            .collect();
        items.sort();
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        let mut mix = |v: u32| {
            for byte in v.to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0100_0000_01b3);
            }
        };
        for (key, forward) in items {
            mix(key.parts().len() as u32);
            key.parts().iter().for_each(|&p| mix(p));
            mix(u32::from(forward));
        }
        let base = Key::root(tag::FACE, &[(hash >> 32) as u32, hash as u32]);
        let mut key = base.clone();
        let mut salt = 0;
        while self.face_keys.contains_key(&key) {
            salt += 1;
            key = base.child(tag::SALT, &[salt]);
        }
        key
    }

    /// Add a face and claim the halves of its walks.
    pub(super) fn new_face(&mut self, birth: NewFace, at: Clock, change: &mut Change) -> FaceId {
        let key = birth
            .name
            .unwrap_or_else(|| self.derived_face_key(birth.outer));
        let id = FaceId(self.faces.len() as u32);
        self.face_keys.insert(key.clone(), id);
        self.faces.push(Face {
            key,
            life: Life::new(at, birth.parents),
            level: birth.level,
            kind: Versioned::new(at, birth.kind),
            outer: Some(birth.outer),
            inners: birth.inners,
            final_outline: None,
        });
        let reps = self.cycles(id);
        self.claim(id, &reps);
        change.born.faces.push(id);
        id
    }

    /// Mark a face retired, keeping `outline` for queries at earlier dates.
    pub(super) fn retire_face(
        &mut self,
        face: FaceId,
        at: Clock,
        outline: Option<Shape>,
        change: &mut Change,
    ) {
        let f = &mut self.faces[face.ix()];
        f.life.died = Some(at);
        f.final_outline = outline;
        change.retired.faces.push(face);
    }

    /// The outline of a face: the outer ring and its holes, leaving out edges that have the face
    /// on both sides (dangling trees and bridges to holes). `None` for the unbounded face. A
    /// retired face gives its outline at retirement.
    pub fn outline(&self, face: FaceId) -> Option<Shape> {
        let f = &self.faces[face.ix()];
        if !f.life.live() {
            return f.final_outline.clone();
        }
        f.outer?;
        let kept = |h: HalfId| self.halves[h.twin().ix()].face != face;
        let mut seen = HashSet::new();
        let mut rings = Vec::new();
        for rep in self.cycles(face) {
            for start in self.trace(rep) {
                if !kept(start) || seen.contains(&start) {
                    continue;
                }
                let mut ring = Vec::new();
                let mut h = start;
                for _ in 0..self.halves.len() {
                    seen.insert(h);
                    let points = self.half_points(h);
                    ring.extend_from_slice(&points[..points.len() - 1]);
                    h = self.halves[h.ix()].next;
                    while !kept(h) && h != start {
                        h = self.halves[h.ix()].next;
                    }
                    if h == start {
                        break;
                    }
                }
                rings.push(ring);
            }
        }
        let mut outer: Option<(f64, Vec<Point>)> = None;
        let mut holes = Vec::new();
        for ring in rings {
            let area = signed(&ring);
            if area > 0.0 {
                if outer.as_ref().is_none_or(|(best, _)| area > *best) {
                    outer = Some((area, ring));
                }
            } else if area < 0.0 {
                holes.push(ring);
            }
        }
        outer.map(|(_, outer)| Shape { outer, holes })
    }

    /// The live edges of a chain walked end to end, with the faces on either side. A chain
    /// that branches or closes is walked from its ends first, then from its smallest key.
    pub fn faces_along_chain(&self, chain: &Key) -> Vec<ChainStep> {
        let mut edges: Vec<EdgeId> = self
            .chains
            .get(chain)
            .map(|list| {
                list.iter()
                    .copied()
                    .filter(|e| self.edges[e.ix()].life.live())
                    .collect()
            })
            .unwrap_or_default();
        edges.sort_by(|a, b| self.edges[a.ix()].key.cmp(&self.edges[b.ix()].key));
        let mut at_node: HashMap<NodeId, Vec<EdgeId>> = HashMap::new();
        for &e in &edges {
            for n in self.edges[e.ix()].nodes {
                at_node.entry(n).or_default().push(e);
            }
        }
        let mut starts: Vec<NodeId> = at_node
            .iter()
            .filter(|(_, list)| list.len() != 2)
            .map(|(&n, _)| n)
            .collect();
        starts.sort_by(|a, b| self.nodes[a.ix()].key.cmp(&self.nodes[b.ix()].key));
        starts.extend(edges.iter().map(|&e| self.edges[e.ix()].nodes[0]));
        let mut used = HashSet::new();
        let mut steps = Vec::new();
        for start in starts {
            let mut node = start;
            while let Some(&e) = at_node
                .get(&node)
                .and_then(|list| list.iter().find(|e| !used.contains(*e)))
            {
                used.insert(e);
                let edge = &self.edges[e.ix()];
                let half = if edge.nodes[0] == node {
                    HalfId::forward(e)
                } else {
                    HalfId::backward(e)
                };
                steps.push(ChainStep {
                    edge: e,
                    half,
                    left: self.halves[half.ix()].face,
                    right: self.halves[half.twin().ix()].face,
                });
                node = self.halves[half.twin().ix()].origin;
            }
        }
        steps
    }
}
