//! Planar half-edge subdivisions by level, with spatial queries and invariant checks.
//!
//! Conventions: a half-edge's face lies on its left; a bounded face's outer walk runs
//! counter-clockwise and its inner walks (holes, detached trees) clockwise; the unbounded face
//! of each level has inner walks only and never retires. An element that is split or merged
//! retires and its children are born with it as parent; retired elements stay in their tables
//! so that the graph can be read at any earlier date. Every element is reachable from its
//! lineage key; handles are indices into the tables.

mod check;
mod elements;
mod history;
mod index;
mod insert;
mod key;
mod remove;
pub mod street_topology;
#[cfg(test)]
mod tests;
mod topology;

use std::collections::HashMap;

use magna_urbis_geom::Point;

pub use elements::{
    ChainStep, Change, Edge, EdgeClass, EdgeSpec, Elements, End, Face, FaceKind, GraphError,
    HalfEdge, Level, Node, NodeKind, Sector,
};
pub use history::{Life, Versioned};
pub use insert::{MIN_PIECE, ON_EDGE, SNAP};
pub use key::{Clock, EdgeId, FaceId, HalfId, Key, NodeId, tag};

use index::{Contact, Grid, bbox, contacts, nearest_on};

/// Slope of the ray cast to locate a point, chosen so that it rarely runs exactly through a vertex.
const RAY_SLOPE: f64 = 0.000_123_456_789;

/// Streets, walls and quays as one planar subdivision per level.
#[derive(Clone, Debug)]
pub struct Graph {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    halves: Vec<HalfEdge>,
    faces: Vec<Face>,
    node_keys: HashMap<Key, NodeId>,
    edge_keys: HashMap<Key, EdgeId>,
    face_keys: HashMap<Key, FaceId>,
    chains: HashMap<Key, Vec<EdgeId>>,
    index: [Grid; 3],
    outside: [FaceId; 3],
}

impl Graph {
    /// An empty graph whose spatial index uses square cells of `cell` metres.
    pub fn new(cell: f64) -> Self {
        let mut graph = Self {
            nodes: vec![],
            edges: vec![],
            halves: vec![],
            faces: vec![],
            node_keys: HashMap::new(),
            edge_keys: HashMap::new(),
            face_keys: HashMap::new(),
            chains: HashMap::new(),
            index: [Grid::new(cell), Grid::new(cell), Grid::new(cell)],
            outside: [FaceId(0); 3],
        };
        for level in Level::ALL {
            let id = FaceId(graph.faces.len() as u32);
            let key = Key::outside(level);
            graph.face_keys.insert(key.clone(), id);
            graph.faces.push(Face {
                key,
                life: Life::new(Clock::ZERO, vec![]),
                level,
                kind: Versioned::new(Clock::ZERO, FaceKind::Unbuilt),
                outer: None,
                inners: vec![],
                final_outline: None,
            });
            graph.outside[level.index()] = id;
        }
        graph
    }

    /// A node by handle.
    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id.ix()]
    }

    /// An edge by handle.
    pub fn edge(&self, id: EdgeId) -> &Edge {
        &self.edges[id.ix()]
    }

    /// A half-edge by handle.
    pub fn half(&self, id: HalfId) -> &HalfEdge {
        &self.halves[id.ix()]
    }

    /// A face by handle.
    pub fn face(&self, id: FaceId) -> &Face {
        &self.faces[id.ix()]
    }

    /// The node holding `key`, live or retired.
    pub fn node_id(&self, key: &Key) -> Option<NodeId> {
        self.node_keys.get(key).copied()
    }

    /// The edge holding `key`, live or retired.
    pub fn edge_id(&self, key: &Key) -> Option<EdgeId> {
        self.edge_keys.get(key).copied()
    }

    /// The face holding `key`, live or retired.
    pub fn face_id(&self, key: &Key) -> Option<FaceId> {
        self.face_keys.get(key).copied()
    }

    /// The unbounded face of `level`.
    pub fn outside(&self, level: Level) -> FaceId {
        self.outside[level.index()]
    }

    /// Face on the left of an edge's polyline.
    pub fn left_face(&self, edge: EdgeId) -> FaceId {
        self.halves[HalfId::forward(edge).ix()].face
    }

    /// Face on the right of an edge's polyline.
    pub fn right_face(&self, edge: EdgeId) -> FaceId {
        self.halves[HalfId::backward(edge).ix()].face
    }

    /// Nodes of the current graph.
    pub fn live_nodes(&self) -> impl Iterator<Item = NodeId> + '_ {
        (0..self.nodes.len())
            .filter(|&i| self.nodes[i].life.live())
            .map(|i| NodeId(i as u32))
    }

    /// Edges of the current graph.
    pub fn live_edges(&self) -> impl Iterator<Item = EdgeId> + '_ {
        (0..self.edges.len())
            .filter(|&i| self.edges[i].life.live())
            .map(|i| EdgeId(i as u32))
    }

    /// Faces of the current graph, the unbounded faces included.
    pub fn live_faces(&self) -> impl Iterator<Item = FaceId> + '_ {
        (0..self.faces.len())
            .filter(|&i| self.faces[i].life.live())
            .map(|i| FaceId(i as u32))
    }

    /// Nodes standing at `clock`.
    pub fn nodes_at(&self, clock: Clock) -> impl Iterator<Item = NodeId> + '_ {
        (0..self.nodes.len())
            .filter(move |&i| self.nodes[i].life.alive_at(clock))
            .map(|i| NodeId(i as u32))
    }

    /// Edges standing at `clock`.
    pub fn edges_at(&self, clock: Clock) -> impl Iterator<Item = EdgeId> + '_ {
        (0..self.edges.len())
            .filter(move |&i| self.edges[i].life.alive_at(clock))
            .map(|i| EdgeId(i as u32))
    }

    /// Every face ever born, live or retired.
    pub fn all_faces(&self) -> impl Iterator<Item = FaceId> + '_ {
        (0..self.faces.len()).map(|i| FaceId(i as u32))
    }

    /// Faces standing at `clock`, the unbounded faces included.
    pub fn faces_at(&self, clock: Clock) -> impl Iterator<Item = FaceId> + '_ {
        (0..self.faces.len())
            .filter(move |&i| self.faces[i].life.alive_at(clock))
            .map(|i| FaceId(i as u32))
    }

    /// Live edges of `level` within `radius` of `p`, ascending.
    pub fn edges_near(&self, level: Level, p: Point, radius: f64) -> Vec<EdgeId> {
        let b = [p.x - radius, p.y - radius, p.x + radius, p.y + radius];
        let mut out = self.index[level.index()].candidates(b);
        out.retain(|e| nearest_on(&self.edges[e.ix()].polyline, p).0 <= radius);
        out
    }

    /// Live edges of `level` that touch or cross the segment `ab`, ascending.
    pub fn edges_crossing(&self, level: Level, a: Point, b: Point) -> Vec<EdgeId> {
        let segment = [a, b];
        let mut out = self.index[level.index()].candidates(bbox(&segment));
        out.retain(|e| !contacts(&segment, &self.edges[e.ix()].polyline).is_empty());
        out
    }

    /// The live face of `level` containing `p`, found by casting a ray to the east. A point on
    /// an edge gets one of the faces beside it.
    pub fn face_at(&self, level: Level, p: Point) -> FaceId {
        let outside = self.outside(level);
        let Some(b) = self.index[level.index()].bounds() else {
            return outside;
        };
        if p.x > b[2] || p.y < b[1] || p.y > b[3] || p.x < b[0] {
            return outside;
        }
        let run = b[2] + 1.0 - p.x;
        let far = Point {
            x: b[2] + 1.0,
            y: p.y + run * RAY_SLOPE,
        };
        let ray = [p, far];
        let mut best: Option<(f64, EdgeId, usize)> = None;
        for e in self.index[level.index()].candidates(bbox(&ray)) {
            let polyline = &self.edges[e.ix()].polyline;
            for (i, w) in polyline.windows(2).enumerate() {
                if let Some(Contact::Point(q)) = index::contact(p, far, w[0], w[1]) {
                    let d = p.distance(q);
                    if best.is_none_or(|(bd, _, _)| d < bd) {
                        best = Some((d, e, i));
                    }
                }
            }
        }
        let Some((_, e, i)) = best else {
            return outside;
        };
        let polyline = &self.edges[e.ix()].polyline;
        let (s0, s1) = (polyline[i], polyline[i + 1]);
        let left = (s1.x - s0.x) * (p.y - s0.y) - (s1.y - s0.y) * (p.x - s0.x) > 0.0;
        if left {
            self.left_face(e)
        } else {
            self.right_face(e)
        }
    }

    fn push_node(
        &mut self,
        key: Key,
        level: Level,
        position: Point,
        kind: NodeKind,
        at: Clock,
    ) -> NodeId {
        let id = NodeId(self.nodes.len() as u32);
        self.node_keys.insert(key.clone(), id);
        self.nodes.push(Node {
            key,
            life: Life::new(at, vec![]),
            level,
            position,
            kind: Versioned::new(at, kind),
            out: vec![],
        });
        id
    }

    /// Add an edge and its two halves, unlinked: each half turns back onto its twin and both
    /// lie in the unbounded face until the caller links and assigns them.
    fn push_edge(&mut self, edge: Edge) -> EdgeId {
        let id = EdgeId(self.edges.len() as u32);
        let (h, t) = (HalfId::forward(id), HalfId::backward(id));
        let face = self.outside(edge.level);
        self.halves.push(HalfEdge {
            origin: edge.nodes[0],
            next: t,
            prev: t,
            face,
        });
        self.halves.push(HalfEdge {
            origin: edge.nodes[1],
            next: h,
            prev: h,
            face,
        });
        self.nodes[edge.nodes[0].ix()].out.push(h);
        self.nodes[edge.nodes[1].ix()].out.push(t);
        self.index[edge.level.index()].insert(id, &edge.polyline);
        if let Some(chain) = &edge.chain {
            self.chains.entry(chain.clone()).or_default().push(id);
        }
        self.edge_keys.insert(edge.key.clone(), id);
        self.edges.push(edge);
        id
    }

    /// Mark an edge retired and take it out of its nodes' arms and the spatial index. Its
    /// halves keep their last links; the caller relinks the nodes.
    fn retire_edge(&mut self, id: EdgeId, at: Clock) {
        let edge = &mut self.edges[id.ix()];
        edge.life.died = Some(at);
        let ([a, b], level) = (edge.nodes, edge.level);
        self.nodes[a.ix()].out.retain(|&h| h != HalfId::forward(id));
        self.nodes[b.ix()]
            .out
            .retain(|&h| h != HalfId::backward(id));
        self.index[level.index()].remove(id, &self.edges[id.ix()].polyline);
    }

    fn live_edge_mut(&mut self, id: EdgeId) -> Result<&mut Edge, GraphError> {
        let edge = self.edges.get_mut(id.ix()).ok_or(GraphError::Unknown)?;
        if edge.life.live() {
            Ok(edge)
        } else {
            Err(GraphError::Retired)
        }
    }

    fn live_node(&self, id: NodeId) -> Result<&Node, GraphError> {
        let node = self.nodes.get(id.ix()).ok_or(GraphError::Unknown)?;
        if node.life.live() {
            Ok(node)
        } else {
            Err(GraphError::Retired)
        }
    }
}
