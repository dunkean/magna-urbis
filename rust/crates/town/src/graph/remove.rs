//! Removing edges, merging nodes, and dated changes of kind, class and rank.

use magna_urbis_geom::{Shape, signed};

use super::topology::NewFace;
use super::{
    Change, Clock, EdgeClass, EdgeId, EdgeSpec, End, FaceId, FaceKind, Graph, GraphError, HalfId,
    Key, NodeId, NodeKind, tag,
};

impl Graph {
    /// Remove an edge. When it separates two faces they retire and one face is born with both
    /// as parents (named `merged`, or from its outer walk), taking the kind of the face on the
    /// edge's left; the unbounded face absorbs a bounded neighbour and stays. An edge with the
    /// same face on both sides (a dangling or bridging edge) leaves that face as it is. The
    /// edge's nodes stay, even when left without arms.
    pub fn remove_edge(
        &mut self,
        edge: EdgeId,
        at: Clock,
        merged: Option<Key>,
    ) -> Result<Change, GraphError> {
        let e = self.edges.get(edge.ix()).ok_or(GraphError::Unknown)?;
        if !e.life.live() {
            return Err(GraphError::Retired);
        }
        if let Some(name) = &merged
            && self.face_keys.contains_key(name)
        {
            return Err(GraphError::DuplicateKey(name.clone()));
        }
        let (level, [a, b]) = (e.level, e.nodes);
        let (h, t) = (HalfId::forward(edge), HalfId::backward(edge));
        let faces = [self.halves[h.ix()].face, self.halves[t.ix()].face];
        let survivors = [self.halves[h.ix()].next, self.halves[t.ix()].next];
        let wh = self.trace(h);
        let mut dropped = vec![self.rep_on(faces[0], &wh)?];
        if !wh.contains(&t) {
            dropped.push(self.rep_on(faces[1], &self.trace(t))?);
        }
        let snapshots = if faces[0] != faces[1] {
            faces.map(|f| self.faces[f.ix()].outer.and_then(|_| self.outline(f)))
        } else {
            [None, None]
        };
        let mut change = Change::default();
        self.retire_edge(edge, at);
        change.retired.edges.push(edge);
        self.relink(a, level);
        self.relink(b, level);
        if faces[0] == faces[1] {
            self.drop_tree_edge(faces[0], &dropped, survivors, [h, t]);
        } else {
            self.merge_faces(
                faces,
                &dropped,
                survivors[0],
                merged,
                snapshots,
                at,
                &mut change,
            );
        }
        Ok(change)
    }

    /// The removed edge had its face on both sides: its walk splits into the walks through
    /// `survivors` (or vanishes with an isolated edge). The largest walk stays outer.
    fn drop_tree_edge(
        &mut self,
        face: FaceId,
        dropped: &[HalfId],
        survivors: [HalfId; 2],
        removed: [HalfId; 2],
    ) {
        let mut walks: Vec<Vec<HalfId>> = Vec::new();
        for s in survivors {
            if !removed.contains(&s) && !walks.iter().any(|w| w.contains(&s)) {
                walks.push(self.trace(s));
            }
        }
        let mut reps: Vec<(f64, HalfId)> = walks
            .iter()
            .map(|w| (signed(&self.ring(w)), w[0]))
            .collect();
        let f = &mut self.faces[face.ix()];
        let was_outer = f.outer.is_some_and(|o| dropped.contains(&o));
        f.inners.retain(|r| !dropped.contains(r));
        if was_outer {
            reps.sort_by(|x, y| y.0.total_cmp(&x.0));
            let mut reps = reps.into_iter().map(|(_, r)| r);
            f.outer = reps.next();
            f.inners.extend(reps);
        } else {
            f.inners.extend(reps.into_iter().map(|(_, r)| r));
        }
    }

    /// The removed edge separated `faces`; their walks through it joined into the walk
    /// through `merged`.
    #[allow(clippy::too_many_arguments)]
    fn merge_faces(
        &mut self,
        faces: [FaceId; 2],
        dropped: &[HalfId],
        merged: HalfId,
        name: Option<Key>,
        snapshots: [Option<Shape>; 2],
        at: Clock,
        change: &mut Change,
    ) {
        let level = self.faces[faces[0].ix()].level;
        let outside = self.outside(level);
        let reps: Vec<HalfId> = faces
            .iter()
            .flat_map(|&f| self.cycles(f))
            .filter(|r| !dropped.contains(r))
            .collect();
        let [left, right] = snapshots;
        if faces.contains(&outside) {
            let (other, snapshot) = if faces[0] == outside {
                (faces[1], right)
            } else {
                (faces[0], left)
            };
            let mut moved: Vec<HalfId> = self.faces[other.ix()]
                .inners
                .iter()
                .copied()
                .filter(|r| !dropped.contains(r))
                .collect();
            moved.push(merged);
            self.retire_face(other, at, snapshot, change);
            let outer = self.faces[other.ix()].outer;
            self.faces[outside.ix()].inners = reps
                .into_iter()
                .filter(|&r| Some(r) != outer)
                .chain([merged])
                .collect();
            self.claim(outside, &moved);
            return;
        }
        let kind = *self.faces[faces[0].ix()].kind.current();
        let parents = faces.map(|f| self.faces[f.ix()].key.clone()).to_vec();
        let kept_outer = faces
            .iter()
            .filter_map(|&f| self.faces[f.ix()].outer)
            .find(|r| !dropped.contains(r));
        self.retire_face(faces[0], at, left, change);
        self.retire_face(faces[1], at, right, change);
        let (outer, inners) = match kept_outer {
            Some(o) => (
                o,
                reps.into_iter()
                    .filter(|&r| r != o)
                    .chain([merged])
                    .collect(),
            ),
            None => (merged, reps),
        };
        let birth = NewFace {
            name,
            level,
            kind,
            parents,
            outer,
            inners,
        };
        self.new_face(birth, at, change);
    }

    /// Merge `gone` into `keep`: each edge of `gone` retires and is born again ending on `keep`,
    /// keyed by its old key and `tag::REANCHOR`; `gone` retires. Faces around the moved edges
    /// retire and are born again. The nodes may not share an edge. Nothing changes on error.
    pub fn merge_nodes(
        &mut self,
        keep: NodeId,
        gone: NodeId,
        at: Clock,
    ) -> Result<Change, GraphError> {
        self.live_node(keep)?;
        self.live_node(gone)?;
        if keep == gone {
            return Err(GraphError::Degenerate("a node merged with itself"));
        }
        let mut incident: Vec<EdgeId> =
            self.nodes[gone.ix()].out.iter().map(|h| h.edge()).collect();
        incident.sort_by(|x, y| self.edges[x.ix()].key.cmp(&self.edges[y.ix()].key));
        incident.dedup();
        if incident
            .iter()
            .any(|e| self.edges[e.ix()].nodes.contains(&keep))
        {
            return Err(GraphError::Degenerate("merged nodes share an edge"));
        }
        let backup = self.clone();
        let result = self.reanchor(keep, gone, &incident, at);
        if result.is_err() {
            *self = backup;
        }
        result
    }

    fn reanchor(
        &mut self,
        keep: NodeId,
        gone: NodeId,
        incident: &[EdgeId],
        at: Clock,
    ) -> Result<Change, GraphError> {
        let mut change = Change::default();
        let target = self.nodes[keep.ix()].position;
        for &id in incident {
            let old = self.edges[id.ix()].clone();
            change.extend(self.remove_edge(id, at, None)?);
            let mut polyline = old.polyline.clone();
            let last = polyline.len() - 1;
            let mut ends = [End::Node(old.nodes[0]), End::Node(old.nodes[1])];
            for (i, slot) in [0, last].into_iter().enumerate() {
                if old.nodes[i] == gone {
                    polyline[slot] = target;
                    ends[i] = End::Node(keep);
                }
            }
            let key = old.key.child(tag::REANCHOR, &[]);
            let spec = EdgeSpec {
                key: key.clone(),
                level: old.level,
                class: *old.class.current(),
                rank: *old.rank.current(),
                polyline,
                widths: old.widths.clone(),
                owner: old.owner.clone(),
                chain: old.chain.clone(),
                face_names: None,
            };
            change.extend(self.insert_edge(spec, ends, at)?);
            let moved = self.edge_keys[&key];
            let edge = &mut self.edges[moved.ix()];
            edge.stem = old.stem.clone();
            edge.life.parents = vec![old.key.clone()];
        }
        self.nodes[gone.ix()].life.died = Some(at);
        change.retired.nodes.push(gone);
        Ok(change)
    }

    /// Change an edge's class from `at` on (road demotion, precinct raised into a wall).
    pub fn set_edge_class(
        &mut self,
        edge: EdgeId,
        class: EdgeClass,
        at: Clock,
    ) -> Result<(), GraphError> {
        self.live_edge_mut(edge)?.class.set(at, class);
        Ok(())
    }

    /// Change an edge's rank from `at` on.
    pub fn set_edge_rank(&mut self, edge: EdgeId, rank: u8, at: Clock) -> Result<(), GraphError> {
        self.live_edge_mut(edge)?.rank.set(at, rank);
        Ok(())
    }

    /// Change a node's kind from `at` on.
    pub fn set_node_kind(
        &mut self,
        node: NodeId,
        kind: NodeKind,
        at: Clock,
    ) -> Result<(), GraphError> {
        self.live_node(node)?;
        self.nodes[node.ix()].kind.set(at, kind);
        Ok(())
    }

    /// Change a face's kind from `at` on.
    pub fn set_face_kind(
        &mut self,
        face: FaceId,
        kind: FaceKind,
        at: Clock,
    ) -> Result<(), GraphError> {
        let f = self.faces.get_mut(face.ix()).ok_or(GraphError::Unknown)?;
        if !f.life.live() {
            return Err(GraphError::Retired);
        }
        f.kind.set(at, kind);
        Ok(())
    }
}
