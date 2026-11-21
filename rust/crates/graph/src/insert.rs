//! Adding nodes and edges: splitting faces, splitting edges, dangling edges.

use std::f64::consts::TAU;

use magna_urbis_geom::{Point, Shape, signed};


use super::index::{Contact, TOUCH, bbox, contacts, nearest_on};
use super::topology::{NewFace, angle, ring_contains};
use super::{
    Change, Clock, Edge, EdgeId, EdgeSpec, End, FaceId, Graph, GraphError, HalfId, Key, Level,
    Life, NodeId, NodeKind, Versioned, tag,
};

/// Largest gap between a polyline end and the node it is said to end on (metres).
pub const SNAP: f64 = 1e-6;
/// Largest gap between a polyline end and the edge it is said to fall on (metres).
pub const ON_EDGE: f64 = 1e-4;
/// Shortest piece left on either side of a split (metres).
pub const MIN_PIECE: f64 = 0.01;

/// An edge end checked against the graph, before anything is changed.
#[derive(Clone, Copy, Debug)]
enum Resolved {
    Node(NodeId),
    OnEdge {
        edge: EdgeId,
        point: Point,
        kind: NodeKind,
    },
    Free {
        point: Point,
        kind: NodeKind,
    },
}

/// How an inserted edge changes the walks of its face.
enum Plan {
    /// Both ends are on one walk, held by this representative: the face splits.
    Split(HalfId),
    /// The ends join these walks (none, one or two) into one; the face is unchanged.
    Join(Vec<HalfId>),
}

impl Graph {
    /// Add a node with no arms. It may not lie on an edge of its level.
    pub fn add_node(
        &mut self,
        key: Key,
        level: Level,
        position: Point,
        kind: NodeKind,
        at: Clock,
    ) -> Result<NodeId, GraphError> {
        if self.node_keys.contains_key(&key) {
            return Err(GraphError::DuplicateKey(key));
        }
        if !(position.x.is_finite() && position.y.is_finite()) {
            return Err(GraphError::Degenerate("node position is not finite"));
        }
        if let Some(&edge) = self.edges_near(level, position, SNAP).first() {
            return Err(GraphError::Crossing(edge));
        }
        Ok(self.push_node(key, level, position, kind, at))
    }

    /// Retire a node that has no live arms.
    pub fn retire_node(&mut self, node: NodeId, at: Clock) -> Result<Change, GraphError> {
        if !self.live_node(node)?.out.is_empty() {
            return Err(GraphError::Degenerate("node still has arms"));
        }
        self.nodes[node.ix()].life.died = Some(at);
        let mut change = Change::default();
        change.retired.nodes.push(node);
        Ok(change)
    }

    /// Insert an edge. Each end is an existing node, a point on an existing edge (which splits)
    /// or a free point (the edge dangles). The edge may touch other edges of its level only at
    /// its ends' nodes. An edge closing a walk splits its face: the face retires and the faces on
    /// either side are born, named by `spec.face_names` or from their outer walks; the unbounded
    /// face stays and only the enclosed face is born. New nodes are keyed by the edge key and
    /// the end (`tag::END`, 0 or 1).
    ///
    /// Every check is made before the graph changes; an error after that point means the
    /// graph was already inconsistent.
    pub fn insert_edge(
        &mut self,
        spec: EdgeSpec,
        ends: [End; 2],
        at: Clock,
    ) -> Result<Change, GraphError> {
        let level = spec.level;
        if self.edge_keys.contains_key(&spec.key) {
            return Err(GraphError::DuplicateKey(spec.key));
        }
        if let Some(names) = &spec.face_names {
            if names[0] == names[1] {
                return Err(GraphError::DuplicateKey(names[0].clone()));
            }
            if let Some(name) = names.iter().find(|k| self.face_keys.contains_key(*k)) {
                return Err(GraphError::DuplicateKey(name.clone()));
            }
        }
        let (mut polyline, widths) = cleaned(spec.polyline, spec.widths)?;
        let last = polyline.len() - 1;
        let ends = [
            self.resolve(ends[0], polyline[0])?,
            self.resolve(ends[1], polyline[last])?,
        ];
        for (i, end) in ends.iter().enumerate() {
            if let Resolved::OnEdge { edge, .. } = *end
                && self.edges[edge.ix()].level != level
            {
                return Err(GraphError::Degenerate("an end on an edge of another level"));
            }
            let key = spec.key.child(tag::END, &[i as u32]);
            if !matches!(end, Resolved::Node(_)) && self.node_keys.contains_key(&key) {
                return Err(GraphError::DuplicateKey(key));
            }
        }
        polyline[0] = self.end_point(&ends[0]);
        polyline[last] = self.end_point(&ends[1]);
        if polyline[0].distance(polyline[last]) < SNAP {
            return Err(GraphError::Loop);
        }
        check_simple(&polyline)?;
        self.check_clear(level, &polyline, &ends)?;
        let face = match (
            self.end_face(level, &ends[0], polyline[1]),
            self.end_face(level, &ends[1], polyline[last - 1]),
        ) {
            (Some(x), Some(y)) if x != y => return Err(GraphError::DifferentFaces),
            (Some(x), _) | (None, Some(x)) => x,
            (None, None) => self.face_at(level, polyline[0]),
        };

        let mut change = Change::default();
        let a = self.realize(&ends[0], &spec.key, 0, level, at, &mut change)?;
        let b = self.realize(&ends[1], &spec.key, 1, level, at, &mut change)?;
        polyline[0] = self.nodes[a.ix()].position;
        polyline[last] = self.nodes[b.ix()].position;
        let sa = self.sector_half(a, level, angle(polyline[0], polyline[1]));
        let sb = self.sector_half(b, level, angle(polyline[last], polyline[last - 1]));
        let plan = self.plan(face, sa, sb)?;
        let snapshot = match plan {
            Plan::Split(_) if self.faces[face.ix()].outer.is_some() => self.outline(face),
            _ => None,
        };
        let e = self.push_edge(Edge {
            key: spec.key.clone(),
            stem: spec.key,
            life: Life::new(at, vec![]),
            level,
            nodes: [a, b],
            polyline,
            widths,
            class: Versioned::new(at, spec.class),
            rank: Versioned::new(at, spec.rank),
            owner: spec.owner,
            chain: spec.chain,
        });
        change.born.edges.push(e);
        let halves = [HalfId::forward(e), HalfId::backward(e)];
        for h in halves {
            self.halves[h.ix()].face = face;
        }
        self.relink(a, level);
        self.relink(b, level);
        match plan {
            Plan::Split(rep) => self.split_face(
                face,
                rep,
                halves,
                spec.face_names,
                snapshot,
                at,
                &mut change,
            ),
            Plan::Join(reps) => self.join_walks(face, &reps, halves[0]),
        }
        Ok(change)
    }

    /// Split a live edge at the point of it nearest to `point`, with a new node keyed `node`.
    /// The edge retires; its two pieces are born with it as parent.
    pub fn split_edge(
        &mut self,
        edge: EdgeId,
        point: Point,
        node: Key,
        kind: NodeKind,
        at: Clock,
    ) -> Result<Change, GraphError> {
        if self.node_keys.contains_key(&node) {
            return Err(GraphError::DuplicateKey(node));
        }
        if !self
            .edges
            .get(edge.ix())
            .ok_or(GraphError::Unknown)?
            .life
            .live()
        {
            return Err(GraphError::Retired);
        }
        let Resolved::OnEdge { edge, point, .. } =
            self.resolve(End::OnEdge { edge, kind }, point)?
        else {
            return Err(GraphError::Inconsistent("edge end resolved elsewhere"));
        };
        let mut change = Change::default();
        self.split_at(edge, point, node, kind, at, &mut change)?;
        Ok(change)
    }

    fn resolve(&self, end: End, point: Point) -> Result<Resolved, GraphError> {
        match end {
            End::Node(n) => {
                if self.live_node(n)?.position.distance(point) > SNAP {
                    return Err(GraphError::OffNode);
                }
                Ok(Resolved::Node(n))
            }
            End::OnEdge { edge, kind } => {
                if edge.ix() >= self.edges.len() {
                    return Err(GraphError::Unknown);
                }
                let edge = self.live_piece(edge, point)?;
                let polyline = &self.edges[edge.ix()].polyline;
                let (d, _, q) = nearest_on(polyline, point);
                if d > ON_EDGE {
                    return Err(GraphError::OffEdge);
                }
                if q.distance(polyline[0]) < MIN_PIECE
                    || q.distance(polyline[polyline.len() - 1]) < MIN_PIECE
                {
                    return Err(GraphError::AtNode);
                }
                Ok(Resolved::OnEdge {
                    edge,
                    point: q,
                    kind,
                })
            }
            End::Free { kind } => Ok(Resolved::Free { point, kind }),
        }
    }

    /// The live edge standing for `edge` at `point`: itself, or the live piece of it under the point.
    fn live_piece(&self, edge: EdgeId, point: Point) -> Result<EdgeId, GraphError> {
        let e = &self.edges[edge.ix()];
        if e.life.live() {
            return Ok(edge);
        }
        let dist = |c: &EdgeId| nearest_on(&self.edges[c.ix()].polyline, point).0;
        self.edges_near(e.level, point, ON_EDGE)
            .into_iter()
            .filter(|c| self.edges[c.ix()].stem == e.stem)
            .min_by(|x, y| dist(x).total_cmp(&dist(y)))
            .ok_or(GraphError::Retired)
    }

    fn end_point(&self, end: &Resolved) -> Point {
        match *end {
            Resolved::Node(n) => self.nodes[n.ix()].position,
            Resolved::OnEdge { point, .. } | Resolved::Free { point, .. } => point,
        }
    }

    /// The face an end opens onto, toward the next polyline point; `None` for an end with no arms.
    fn end_face(&self, level: Level, end: &Resolved, toward: Point) -> Option<FaceId> {
        match *end {
            Resolved::Node(n) => {
                let from = self.nodes[n.ix()].position;
                self.sector_half(n, level, angle(from, toward))
                    .map(|h| self.halves[h.ix()].face)
            }
            Resolved::OnEdge { edge, point, .. } => {
                let h = if self.leaves_left(edge, point, toward) {
                    HalfId::forward(edge)
                } else {
                    HalfId::backward(edge)
                };
                Some(self.halves[h.ix()].face)
            }
            Resolved::Free { .. } => None,
        }
    }

    /// Whether a line leaving `edge` at `q` toward `toward` goes to the left of the edge: into the
    /// angle from the edge ahead counter-clockwise to the edge behind.
    fn leaves_left(&self, edge: EdgeId, q: Point, toward: Point) -> bool {
        let p = &self.edges[edge.ix()].polyline;
        let (_, seg, _) = nearest_on(p, q);
        let last = p.len() - 1;
        let (behind, ahead) = if seg > 0 && q.distance(p[seg]) < TOUCH {
            (p[seg - 1], p[seg + 1])
        } else if seg + 1 < last && q.distance(p[seg + 1]) < TOUCH {
            (p[seg], p[seg + 2])
        } else {
            (p[seg], p[seg + 1])
        };
        let start = angle(q, ahead);
        let turn = |a: f64| (a - start).rem_euclid(TAU);
        turn(angle(q, toward)) < turn(angle(q, behind))
    }

    /// The polyline may touch live edges of its level only at its ends: at an end node on an edge
    /// of that node, or on the edge an end splits.
    fn check_clear(
        &self,
        level: Level,
        polyline: &[Point],
        ends: &[Resolved; 2],
    ) -> Result<(), GraphError> {
        let tips = [polyline[0], polyline[polyline.len() - 1]];
        for e in self.index[level.index()].candidates(bbox(polyline)) {
            for contact in contacts(polyline, &self.edges[e.ix()].polyline) {
                let Contact::Point(p) = contact else {
                    return Err(GraphError::Crossing(e));
                };
                let allowed = ends.iter().zip(tips).any(|(end, tip)| {
                    p.distance(tip) <= SNAP
                        && match *end {
                            Resolved::Node(n) => self.edges[e.ix()].nodes.contains(&n),
                            Resolved::OnEdge { edge, .. } => edge == e,
                            Resolved::Free { .. } => false,
                        }
                });
                if !allowed {
                    return Err(GraphError::Crossing(e));
                }
            }
        }
        Ok(())
    }

    /// Classify the insertion from the sectors the edge leaves through at each end.
    fn plan(
        &self,
        face: FaceId,
        sa: Option<HalfId>,
        sb: Option<HalfId>,
    ) -> Result<Plan, GraphError> {
        if [sa, sb]
            .into_iter()
            .flatten()
            .any(|s| self.halves[s.ix()].face != face)
        {
            return Err(GraphError::Inconsistent("sector outside the edge's face"));
        }
        Ok(match (sa, sb) {
            (Some(x), Some(y)) => {
                let wx = self.trace(x);
                let rx = self.rep_on(face, &wx)?;
                if wx.contains(&y) {
                    Plan::Split(rx)
                } else {
                    Plan::Join(vec![rx, self.rep_on(face, &self.trace(y))?])
                }
            }
            (Some(x), None) | (None, Some(x)) => {
                Plan::Join(vec![self.rep_on(face, &self.trace(x))?])
            }
            (None, None) => Plan::Join(vec![]),
        })
    }

    /// The node for an end, creating it (and splitting an edge) when needed.
    fn realize(
        &mut self,
        end: &Resolved,
        edge_key: &Key,
        i: u32,
        level: Level,
        at: Clock,
        change: &mut Change,
    ) -> Result<NodeId, GraphError> {
        let key = edge_key.child(tag::END, &[i]);
        match *end {
            Resolved::Node(n) => Ok(n),
            Resolved::Free { point, kind } => {
                let n = self.push_node(key, level, point, kind, at);
                change.born.nodes.push(n);
                Ok(n)
            }
            Resolved::OnEdge { edge, point, kind } => {
                // An earlier end of the same edge may have split it already.
                let piece = self.live_piece(edge, point)?;
                self.split_at(piece, point, key, kind, at, change)
            }
        }
    }

    /// Split a live edge at its point nearest to `point`. The pieces are keyed by the edge's
    /// stem and their end nodes, so that pieces are named the same whatever order the splits of
    /// one edge come in.
    fn split_at(
        &mut self,
        edge: EdgeId,
        point: Point,
        key: Key,
        kind: NodeKind,
        at: Clock,
        change: &mut Change,
    ) -> Result<NodeId, GraphError> {
        let old = self.edges[edge.ix()].clone();
        let p = &old.polyline;
        let last = p.len() - 1;
        let (_, seg, q) = nearest_on(p, point);
        let vertex = if seg > 0 && q.distance(p[seg]) < TOUCH {
            Some(seg)
        } else if seg + 1 < last && q.distance(p[seg + 1]) < TOUCH {
            Some(seg + 1)
        } else {
            None
        };
        let (first, second) = match vertex {
            Some(v) => (p[..=v].to_vec(), p[v..].to_vec()),
            None => {
                let mut first = p[..=seg].to_vec();
                first.push(q);
                let mut second = vec![q];
                second.extend_from_slice(&p[seg + 1..]);
                (first, second)
            }
        };
        let len = p[seg].distance(p[seg + 1]);
        let fraction = if len > 0.0 {
            p[seg].distance(q) / len
        } else {
            0.0
        };
        let [first_w, second_w] = split_profile(&old.widths, vertex, seg, fraction);
        let position = first[first.len() - 1];
        if position.distance(p[0]) < MIN_PIECE || position.distance(p[last]) < MIN_PIECE {
            return Err(GraphError::AtNode);
        }
        let n = self.push_node(key, old.level, position, kind, at);
        let [a, b] = old.nodes;
        let (fwd, bwd) = (HalfId::forward(edge), HalfId::backward(edge));
        let (ff, fb) = (self.halves[fwd.ix()].face, self.halves[bwd.ix()].face);
        self.retire_edge(edge, at);
        let keys = [a, n, b].map(|x| self.nodes[x.ix()].key.clone());
        let piece =
            |from: usize, polyline: Vec<Point>, widths: Vec<f64>, nodes: [NodeId; 2]| Edge {
                key: old
                    .stem
                    .nested(tag::PIECE_FROM, &keys[from])
                    .nested(tag::PIECE_TO, &keys[from + 1]),
                stem: old.stem.clone(),
                life: Life::new(at, vec![old.key.clone()]),
                level: old.level,
                nodes,
                polyline,
                widths,
                class: Versioned::new(at, *old.class.current()),
                rank: Versioned::new(at, *old.rank.current()),
                owner: old.owner.clone(),
                chain: old.chain.clone(),
            };
        let e1 = self.push_edge(piece(0, first, first_w, [a, n]));
        let e2 = self.push_edge(piece(1, second, second_w, [n, b]));
        for (h, face) in [
            (HalfId::forward(e1), ff),
            (HalfId::forward(e2), ff),
            (HalfId::backward(e1), fb),
            (HalfId::backward(e2), fb),
        ] {
            self.halves[h.ix()].face = face;
        }
        for x in [a, b, n] {
            self.relink(x, old.level);
        }
        self.replace_rep(ff, fwd, HalfId::forward(e1));
        self.replace_rep(fb, bwd, HalfId::backward(e2));
        change.retired.edges.push(edge);
        change.born.nodes.push(n);
        change.born.edges.extend([e1, e2]);
        Ok(n)
    }

    /// The new edge closed a walk into two. Faces whose outer walk splits give two bounded
    /// faces; a split inner walk encloses a new face, the rest stays an inner walk. Holes go to
    /// the face that contains them.
    #[allow(clippy::too_many_arguments)]
    fn split_face(
        &mut self,
        face: FaceId,
        rep: HalfId,
        halves: [HalfId; 2],
        names: Option<[Key; 2]>,
        snapshot: Option<Shape>,
        at: Clock,
        change: &mut Change,
    ) {
        let walks = halves.map(|h| self.trace(h));
        let rings = walks.each_ref().map(|w| self.ring(w));
        let f = self.faces[face.ix()].clone();
        let (level, kind, parents) = (f.level, *f.kind.current(), vec![f.key.clone()]);
        let name = |i: usize| names.as_ref().map(|n| n[i].clone());
        let others: Vec<HalfId> = f.inners.iter().copied().filter(|&r| r != rep).collect();
        if f.outer == Some(rep) {
            let (left, right): (Vec<HalfId>, Vec<HalfId>) = others
                .into_iter()
                .partition(|&r| self.walk_inside(&rings[0], r));
            self.retire_face(face, at, snapshot, change);
            for (side, inners) in [left, right].into_iter().enumerate() {
                let birth = NewFace {
                    name: name(side),
                    level,
                    kind,
                    parents: parents.clone(),
                    outer: halves[side],
                    inners,
                };
                self.new_face(birth, at, change);
            }
            return;
        }
        let enclosed = if signed(&rings[0]) >= signed(&rings[1]) {
            0
        } else {
            1
        };
        let (moved, mut kept): (Vec<HalfId>, Vec<HalfId>) = others
            .into_iter()
            .partition(|&r| self.walk_inside(&rings[enclosed], r));
        kept.push(halves[1 - enclosed]);
        if f.outer.is_none() {
            self.faces[face.ix()].inners = kept;
            self.claim(face, &[halves[1 - enclosed]]);
        } else {
            self.retire_face(face, at, snapshot, change);
            let rest = NewFace {
                name: name(1 - enclosed),
                level,
                kind,
                parents: parents.clone(),
                outer: f.outer.unwrap_or(rep),
                inners: kept,
            };
            self.new_face(rest, at, change);
        }
        let birth = NewFace {
            name: name(enclosed),
            level,
            kind,
            parents,
            outer: halves[enclosed],
            inners: moved,
        };
        self.new_face(birth, at, change);
    }

    /// Whether the walk through `rep`, which touches no other walk, lies inside `ring`.
    fn walk_inside(&self, ring: &[Point], rep: HalfId) -> bool {
        ring_contains(ring, self.nodes[self.halves[rep.ix()].origin.ix()].position)
    }

    /// The new edge joined `reps`' walks (or started a new one) without closing a walk.
    fn join_walks(&mut self, face: FaceId, reps: &[HalfId], half: HalfId) {
        let f = &mut self.faces[face.ix()];
        let was_outer = f.outer.is_some_and(|o| reps.contains(&o));
        f.inners.retain(|r| !reps.contains(r));
        if was_outer {
            f.outer = Some(half);
        } else {
            f.inners.push(half);
        }
        self.claim(face, &[half]);
    }
}

/// Split a per-vertex profile at a vertex or interpolate a new sample.
fn split_profile(values: &[f64], vertex: Option<usize>, segment: usize, fraction: f64) -> [Vec<f64>; 2] {
    if let Some(vertex) = vertex {
        return [values[..=vertex].to_vec(), values[vertex..].to_vec()];
    }
    let value = values[segment] + (values[segment + 1] - values[segment]) * fraction;
    let mut first = values[..=segment].to_vec();
    first.push(value);
    let mut second = vec![value];
    second.extend_from_slice(&values[segment + 1..]);
    [first, second]
}

/// Drop repeated points and their width samples.
fn cleaned(polyline: Vec<Point>, widths: Vec<f64>) -> Result<(Vec<Point>, Vec<f64>), GraphError> {
    if widths.len() != polyline.len() {
        return Err(GraphError::Degenerate("one width per polyline vertex"));
    }
    if polyline
        .iter()
        .any(|p| !(p.x.is_finite() && p.y.is_finite()))
    {
        return Err(GraphError::Degenerate("polyline is not finite"));
    }
    let mut points: Vec<Point> = Vec::with_capacity(polyline.len());
    let mut kept = Vec::with_capacity(widths.len());
    for (p, w) in polyline.into_iter().zip(widths) {
        if points.last().is_some_and(|q| q.distance(p) < TOUCH) {
            continue;
        }
        points.push(p);
        kept.push(w);
    }
    if points.len() < 2 {
        return Err(GraphError::Degenerate("polyline shorter than one segment"));
    }
    Ok((points, kept))
}

/// A polyline may touch itself only where consecutive segments share their vertex.
pub(super) fn check_simple(polyline: &[Point]) -> Result<(), GraphError> {
    let n = polyline.len() - 1;
    for i in 0..n {
        for j in i + 1..n {
            let touch =
                super::index::contact(polyline[i], polyline[i + 1], polyline[j], polyline[j + 1]);
            match touch {
                None => {}
                Some(Contact::Point(_)) if j == i + 1 => {}
                Some(_) => return Err(GraphError::Degenerate("polyline touches itself")),
            }
        }
    }
    Ok(())
}
